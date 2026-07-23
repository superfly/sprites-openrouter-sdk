@mvp
Feature: Workspace recovery points
  As an agent application developer
  I want checkpoints around risky agent work
  So that I can restore a known filesystem state

  @fake @live
  Scenario: On-open checkpoint completes before tools are returned
    Given an existing Sprite named "agent-checkpoint"
    When I open a workspace with checkpoint "on-open"
    Then the checkpoint stream is consumed to completion
    And the workspace is returned only after checkpoint completion
    And a "checkpoint.created" event contains the checkpoint ID

  @fake
  Scenario: Policy configuration precedes the on-open checkpoint
    Given an existing Sprite named "agent-checkpoint"
    When I open a workspace with an explicit network policy and checkpoint "on-open"
    Then the network policy update completes before checkpoint creation starts

  @fake @live
  Scenario: On-open checkpoint failure rejects the workspace
    Given checkpoint creation will fail
    When I open a workspace with checkpoint "on-open"
    Then opening the workspace fails with the checkpoint error
    And no usable workspace is returned
    And the Sprite is not destroyed

  @fake @live
  Scenario: Explicit restore completes before resolving
    Given checkpoint "v1" contains file "/workspace/value.txt" with content "before"
    And the current file content is "after"
    When I restore checkpoint "v1"
    Then the restore stream is consumed to completion
    And file "/workspace/value.txt" contains "before"
    And a "checkpoint.restored" event contains checkpoint ID "v1"

  @fake
  Scenario: Restore and destroy are not model tools
    Given tools created with every available preset and include option
    Then no model-visible tool can restore a checkpoint
    And no model-visible tool can destroy a Sprite
