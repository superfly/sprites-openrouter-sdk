@mvp @live
Feature: Persistent computer for a multi-turn coding agent
  As a developer building with the OpenRouter Agent SDK
  I want an agent to resume work in the same Sprite
  So that repositories, dependencies, and artifacts survive application requests

  Scenario: A coding task continues in a later OpenRouter call
    Given a fresh named workspace configured with the "coding" preset
    And a fixture repository with one failing test
    When a first OpenRouter agent run clones the fixture repository
    And the first run installs its dependencies
    And the first run diagnoses the failing test
    And the application closes the workspace
    And a second application request opens the same named workspace
    And a second OpenRouter agent run fixes the failing test
    Then the dependency installation is still present
    And the repository changes from the first run are still present
    And the complete test suite passes inside the Sprite
    And the application host filesystem was not used as the agent workspace
    And closing either run did not destroy the Sprite

  Scenario: A failed run can be rolled back by the host
    Given a named workspace opened with checkpoint "on-open"
    And an OpenRouter agent run makes unwanted filesystem changes
    When the host restores the on-open checkpoint
    Then all filesystem changes made after that checkpoint are absent
    And the Sprite remains available for another agent run
