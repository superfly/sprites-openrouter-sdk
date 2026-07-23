@mvp
Feature: Bounded and recoverable tool output
  As an agent application developer
  I want tool results to fit predictable context limits
  So that one command cannot overwhelm the model conversation

  @fake @live
  Scenario: Output below the limit is unchanged
    Given tools with max output bytes 1024
    When a command writes 400 UTF-8 bytes to stdout
    Then the complete stdout is returned
    And result metadata has truncated false
    And result metadata has no full output path

  @fake @live
  Scenario: Large output preserves useful head and tail
    Given tools with max output bytes 1024
    When a command writes a unique 800-byte prefix and a unique 800-byte suffix
    Then the combined model-facing stdout and stderr is at most 1024 UTF-8 bytes
    And stdout contains content from the unique prefix
    And stdout contains content from the unique suffix
    And stdout contains a visible omission marker
    And result metadata has truncated true

  @fake @live
  Scenario: Complete truncated output is persisted
    Given tools with max output bytes 1024
    When a command writes 4096 UTF-8 bytes to stdout
    Then result metadata has truncated true
    And result metadata contains a full output path beneath "/workspace/.sprite-agent/results"
    And reading the full output path returns all 4096 bytes

  @fake
  Scenario: Overflow persistence failure does not hide command success
    Given tools with max output bytes 1024
    And overflow result persistence will fail
    When a successful command writes 4096 UTF-8 bytes to stdout
    Then the tool result has ok true
    And result metadata has truncated true
    And result metadata has no full output path

  @fake @live
  Scenario: Requested timeout is clamped to the workspace maximum
    Given tools with command timeout 100 milliseconds
    When the model requests a 10000 millisecond timeout for a long-running command
    Then the command is stopped after the configured maximum
    And the tool result has ok false
    And the error code is "timed_out"
    And the error is retryable

  @fake
  Scenario: A transport failure is returned to the model
    Given Sprite command execution fails before the command starts
    When the model calls "sprite_exec"
    Then the tool result has ok false
    And the error code is "transport_error"
    And the error is retryable
    And the result is JSON serializable
