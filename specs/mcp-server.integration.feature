@integration @mcp
Feature: MCP server integration
  Validate the MCP server exposed by allata-llc/mcp-server.

  Background:
    Given the MCP server integration is configured

  Scenario: Discover the echo tool
    When I initialize an MCP session
    And I list the MCP tools
    Then the MCP tool list contains "echo"

  Scenario: Call the echo tool
    When I initialize an MCP session
    And I call the MCP tool "echo" with message "hello from AgenticAI"
    Then the MCP tool result is "hello from AgenticAI"