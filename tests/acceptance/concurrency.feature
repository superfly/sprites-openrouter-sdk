@mvp
Feature: Operations against one Sprite are ordered safely
  As an agent application developer
  I want concurrent model tool calls to avoid workspace races
  So that OpenRouter parallel tool execution does not corrupt agent state

  Background:
    Given a workspace using "serialize-mutations" concurrency

  @fake
  Scenario: Mutations run in request-arrival order
    Given mutation "A" blocks until released
    When mutation "A" is requested
    And mutation "B" is requested before "A" finishes
    Then mutation "B" has not started
    When mutation "A" is released
    Then mutation "A" finishes before mutation "B" starts

  @fake
  Scenario: Reads wait for an earlier mutation
    Given mutation "A" blocks until released
    When mutation "A" is requested
    And read "R" is requested before "A" finishes
    Then read "R" has not started
    When mutation "A" is released
    Then mutation "A" finishes before read "R" starts

  @fake
  Scenario: Independent reads may overlap
    Given read "R1" blocks until released
    When read "R1" is requested
    And read "R2" is requested
    Then read "R2" starts before read "R1" is released

  @fake
  Scenario: A new mutation waits for active reads
    Given reads "R1" and "R2" are active
    When mutation "A" is requested
    Then mutation "A" has not started
    When reads "R1" and "R2" finish
    Then mutation "A" starts

  @fake
  Scenario Outline: A failed mutation releases the queue
    Given mutation "A" will <outcome>
    When mutation "A" is requested
    And mutation "B" is requested
    Then mutation "B" starts after mutation "A" finishes

    Examples:
      | outcome  |
      | fail     |
      | time out |
      | cancel   |

  @fake
  Scenario: Parallel mode is an explicit escape hatch
    Given a workspace using "parallel" concurrency
    And mutation "A" blocks until released
    When mutation "A" is requested
    And mutation "B" is requested
    Then mutation "B" starts before mutation "A" is released
