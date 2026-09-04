@integration @pipeline
Feature: Pipeline function integration
  Validate the Service Bus contract exposed by allata-llc/pipeline-function.

  Scenario: Register the pipeline Service Bus blueprint
    Given the pipeline function source is available
    Then the pipeline function registers the Service Bus blueprint
    And the pipeline queue is configured as "cope-requests"

  @live
  Scenario: Publish a valid property request
    Given the pipeline Service Bus integration is configured
    When I publish a valid property request to the pipeline queue
    Then the pipeline request is accepted by Service Bus