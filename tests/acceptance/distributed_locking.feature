@later @live
Feature: Production coordination across application workers
  As an operator running horizontally scaled agent applications
  I want a distributed lock for one Sprite workspace
  So that separate workers cannot mutate the same computer concurrently

  Scenario: Two workers use a distributed lock for one Sprite
    Given two application workers open the same named Sprite workspace
    And a distributed workspace lock provider is configured
    When both workers request mutations concurrently
    Then only one worker mutates the Sprite at a time
