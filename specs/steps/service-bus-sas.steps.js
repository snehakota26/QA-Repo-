const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const {
  bodyAsText,
  brokerProperties,
  buildQueueSasToken,
  createPeekClient,
  messagesUrl,
  namespaceHost,
  peekDeadLetterQueue,
  peekQueue
} = require('../support/service-bus-sas');

const peekMaxMessages = () => Number(process.env.SERVICE_BUS_PEEK_MAX_MESSAGES || 32);
const pollIntervalMs = () => Number(process.env.SERVICE_BUS_PEEK_INTERVAL_MS || 5000);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(message) {
  console.log(`[service-bus-sas] ${message}`);
}

Given('the Service Bus SAS integration is configured for namespace {string}', function (namespaceName) {
  assert.ok(this.request, 'Integration request context was not initialized');
  this.sasNamespaceName = namespaceName;
  this.sasNamespaceHost = namespaceHost(process.env, namespaceName);
  log(`Namespace resolved to "${this.sasNamespaceHost}".`);
});

Given('a SAS token is generated for the {string} queue using the {string} shared access policy',
  function (queueName, policyName) {
    const { resourceUri, keyName, token, expiry } = buildQueueSasToken({
      namespaceName: this.sasNamespaceName,
      queueName,
      policyName
    });

    this.sasQueueName = queueName;
    this.sasResourceUri = resourceUri;
    this.sasToken = token;

    log(`Generated SAS token for "${resourceUri}" with policy "${keyName}", expires ${new Date(expiry * 1000).toISOString()}.`);
  });

When('I publish the property request over HTTP to the {string} queue with correlation id {string}, source system {string}, address line1 {string}, city {string}, state {string} and zip code {string}',
  async function (queueName, correlationId, sourceSystem, line1, city, state, zipCode) {
    assert.ok(this.sasToken, 'Generate a SAS token before publishing over HTTP');
    assert.equal(queueName, this.sasQueueName, 'The SAS token was generated for a different queue');

    this.sasCorrelationId = correlationId;
    this.sasPublishedAt = new Date();
    this.sasMessage = {
      requestMetadata: {
        correlationId,
        sourceSystem,
        requestTimestamp: this.sasPublishedAt.toISOString()
      },
      propertyAddress: {
        line1,
        line2: '',
        city,
        state,
        zipCode
      }
    };

    log(`POSTing property request "${correlationId}" to queue "${queueName}"...`);
    this.sasResponse = await this.request.post(messagesUrl(this.sasResourceUri), {
      headers: {
        Authorization: this.sasToken,
        'Content-Type': 'application/json',
        BrokerProperties: brokerProperties({ messageId: correlationId, correlationId })
      },
      data: JSON.stringify(this.sasMessage)
    });

    log(`Service Bus REST responded with status ${this.sasResponse.status()}.`);
  });

Then('the Service Bus REST response status is {int}', async function (expectedStatus) {
  const status = this.sasResponse.status();
  if (status !== expectedStatus) {
    const body = await this.sasResponse.text();
    assert.fail(`Expected status ${expectedStatus} but got ${status}: ${body}`);
  }
});

Then('I peek the next messages on the {string} queue within {int} seconds',
  { timeout: 300 * 1000 },
  async function (queueName, timeoutSeconds) {
    const { client, authMode } = createPeekClient(process.env, this.sasNamespaceName);
    this.sasPeekClient = client;
    this.sasPeekQueueName = queueName;

    const deadline = Date.now() + timeoutSeconds * 1000;
    const maxCount = peekMaxMessages();
    log(`Peeking queue "${queueName}" using ${authMode} (timeout ${timeoutSeconds}s)...`);

    try {
      let attempt = 0;
      while (Date.now() < deadline) {
        attempt += 1;
        const active = await peekQueue(client, queueName, maxCount);
        const deadLettered = await peekDeadLetterQueue(client, queueName, maxCount);
        this.sasPeekedMessages = [...active, ...deadLettered];

        log(`Attempt ${attempt}: ${active.length} active, ${deadLettered.length} dead-lettered message(s).`);
        if (this.sasPeekedMessages.some(message => matchesCorrelationId(message, this.sasCorrelationId))) {
          log(`Found a message for correlation id "${this.sasCorrelationId}".`);
          return;
        }

        if (Date.now() + pollIntervalMs() >= deadline) break;
        await sleep(pollIntervalMs());
      }
    } finally {
      await client.close();
      this.sasPeekClient = null;
    }

    assert.fail(
      `No message matching correlation id "${this.sasCorrelationId}" appeared on queue "${queueName}" within ${timeoutSeconds} seconds`
    );
  });

function matchesCorrelationId(message, correlationId) {
  return (
    message.messageId === correlationId ||
    message.correlationId === correlationId ||
    bodyAsText(message).includes(correlationId)
  );
}

Then('the peeked messages contain the message id for the published correlation id', function () {
  assert.ok(this.sasPeekedMessages?.length, 'No messages were peeked');
  this.sasMatchedMessage = this.sasPeekedMessages.find(message =>
    matchesCorrelationId(message, this.sasCorrelationId)
  );

  assert.ok(
    this.sasMatchedMessage,
    `Peeked messages did not contain correlation id "${this.sasCorrelationId}"`
  );
  log(`Matched message id "${this.sasMatchedMessage.messageId}" (sequence ${this.sasMatchedMessage.sequenceNumber}).`);
});

Then('the peeked message body is valid JSON', function () {
  const text = bodyAsText(this.sasMatchedMessage);
  assert.ok(text, 'The peeked message body was empty');

  const parsed = JSON.parse(text);
  assert.ok(parsed && typeof parsed === 'object', 'The peeked message body was not a JSON object');
  log(`Peeked message body keys: ${Object.keys(parsed).join(', ')}.`);
});
