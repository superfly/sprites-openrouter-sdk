@mvp
Feature: Managed Sprite workspace lifecycle
  As an agent application developer
  I want predictable create, reuse, close, and destroy behavior
  So that agent work persists without leaking unintended infrastructure actions

  @fake @live
  Scenario: A named target reuses an existing Sprite
    Given Sprite "agent-reuse" already exists
    When I open named workspace "agent-reuse" with create "if-missing"
    Then no Sprite is created
    And the workspace references Sprite "agent-reuse"
    And a "workspace.opened" event reports created false

  @fake @live
  Scenario: A named target creates a missing Sprite when permitted
    Given Sprite "agent-create" does not exist
    When I open named workspace "agent-create" with create "if-missing"
    Then Sprite "agent-create" is created exactly once
    And the workspace references Sprite "agent-create"
    And a "workspace.opened" event reports created true

  @fake
  Scenario: A concurrent create conflict is recovered by lookup
    Given Sprite "agent-race" is missing during the first lookup
    And another process creates Sprite "agent-race" before this process creates it
    When I open named workspace "agent-race" with create "if-missing"
    Then the create conflict is followed by one lookup
    And the workspace references Sprite "agent-race"

  @fake @live
  Scenario: Missing infrastructure is not created by default
    Given Sprite "agent-missing" does not exist
    When I open named workspace "agent-missing" without a create option
    Then opening the workspace fails with a typed not-found error
    And no Sprite is created

  @fake @live
  Scenario: Closing preserves the Sprite and its files
    Given an open managed workspace for Sprite "agent-close"
    And the workspace contains file "/workspace/result.txt"
    When I close the workspace twice
    Then both close operations succeed
    And Sprite "agent-close" still exists
    And file "/workspace/result.txt" still exists
    And new tool calls through the closed workspace are rejected

  @fake @live
  Scenario: Detachable processes survive close
    Given an open managed workspace with a detachable process running
    When I close the workspace
    Then the Sprite exec session remains running

  @fake @live
  Scenario: Destroy is explicit and idempotent
    Given an open managed workspace for Sprite "agent-destroy"
    When I destroy the workspace twice
    Then both destroy operations succeed
    And Sprite "agent-destroy" no longer exists
    And a "workspace.destroyed" event is emitted once

  @fake
  Scenario: An event callback failure does not fail lifecycle behavior
    Given an event callback that throws an error
    When I open and close a workspace
    Then opening and closing succeed
