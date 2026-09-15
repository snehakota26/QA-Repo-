const assert = require('node:assert/strict');
const { ServiceBusClient } = require('@azure/service-bus');
const { createAzureCredential } = require('./azure-credential');

function resolvePipelineServiceBusConfig(env = process.env) {
  const connection = env.SERVICE_BUS_CONNECTION?.trim();
  const queueName = env.PIPELINE_QUEUE_NAME?.trim() || 'cope-requests';

  if (connection) {
    return { connection, queueName };
  }

  const fullyQualifiedNamespace = env.SERVICE_BUS_NAMESPACE_FQDN?.trim();
  assert.ok(
    fullyQualifiedNamespace,
    'Set SERVICE_BUS_CONNECTION, or set SERVICE_BUS_NAMESPACE_FQDN with Azure SDK credentials, to run pipeline integration scenarios'
  );

  return { fullyQualifiedNamespace, queueName };
}

function connectPipelineServiceBus(
  env = process.env,
  {
    ServiceBusClientImpl = ServiceBusClient,
    createCredential = createAzureCredential
  } = {}
) {
  const config = resolvePipelineServiceBusConfig(env);
  const client = config.connection
    ? new ServiceBusClientImpl(config.connection)
    : new ServiceBusClientImpl(
        config.fullyQualifiedNamespace,
        createCredential(env)
      );

  return {
    client,
    sender: client.createSender(config.queueName),
    queueName: config.queueName
  };
}

module.exports = {
  connectPipelineServiceBus,
  resolvePipelineServiceBusConfig
};
