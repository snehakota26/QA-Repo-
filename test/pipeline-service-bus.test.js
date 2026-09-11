const test = require('node:test');
const assert = require('node:assert/strict');

const {
  connectPipelineServiceBus,
  resolvePipelineServiceBusConfig
} = require('../specs/support/pipeline-service-bus');

test('resolvePipelineServiceBusConfig prefers SERVICE_BUS_CONNECTION when present', () => {
  assert.deepEqual(
    resolvePipelineServiceBusConfig({
      SERVICE_BUS_CONNECTION: 'Endpoint=sb://example/',
      SERVICE_BUS_NAMESPACE_FQDN: 'ignored.servicebus.windows.net',
      PIPELINE_QUEUE_NAME: 'cope-requests'
    }),
    {
      connection: 'Endpoint=sb://example/',
      queueName: 'cope-requests'
    }
  );
});

test('connectPipelineServiceBus falls back to namespace + DefaultAzureCredential', () => {
  const calls = [];

  class FakeCredential {}
  class FakeServiceBusClient {
    constructor(...args) {
      this.args = args;
      calls.push(args);
    }

    createSender(queueName) {
      return { queueName };
    }
  }

  const { client, sender, queueName } = connectPipelineServiceBus(
    {
      SERVICE_BUS_NAMESPACE_FQDN: 'cope-pocsb.servicebus.windows.net'
    },
    {
      ServiceBusClientImpl: FakeServiceBusClient,
      DefaultAzureCredentialImpl: FakeCredential
    }
  );

  assert.equal(queueName, 'cope-requests');
  assert.equal(sender.queueName, 'cope-requests');
  assert.equal(client.args[0], 'cope-pocsb.servicebus.windows.net');
  assert.ok(client.args[1] instanceof FakeCredential);
  assert.equal(calls.length, 1);
});

test('resolvePipelineServiceBusConfig errors when neither connection nor namespace is set', () => {
  assert.throws(
    () => resolvePipelineServiceBusConfig({}),
    /Set SERVICE_BUS_CONNECTION, or set SERVICE_BUS_NAMESPACE_FQDN with Azure SDK credentials/
  );
});
