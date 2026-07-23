@mvp
Feature: OpenRouter tools backed by an existing Sprite
  As an agent application developer
  I want ordinary OpenRouter tools backed by my Sprite
  So that I can add persistent compute without replacing my agent loop

  @fake @live
  Scenario: The minimal preset has a stable tool surface
    Given an existing Sprite named "acceptance-tools"
    When I create Sprite tools with the "minimal" preset
    Then the model-visible tool names in order are:
      | name                  |
      | sprite_exec           |
      | sprite_read_file      |
      | sprite_write_file     |
      | sprite_list_directory |

  @fake
  Scenario: Include adds a tool and exclude wins
    Given an existing Sprite named "acceptance-tools"
    When I create Sprite tools with the "minimal" preset
    And I include "searchFiles" and "applyPatch"
    And I exclude "writeFile" and "searchFiles"
    Then the model-visible tool names in order are:
      | name                  |
      | sprite_exec           |
      | sprite_read_file      |
      | sprite_list_directory |
      | sprite_apply_patch    |

  @fake @live
  Scenario: A successful command returns a structured result
    Given an existing Sprite named "acceptance-tools"
    And Sprite tools configured with cwd "/workspace"
    When the model calls "sprite_exec" with command "printf hello"
    Then the tool result has ok true
    And the tool data has exit code 0
    And stdout is "hello"
    And stderr is empty
    And result metadata includes a non-negative duration
    And the result is JSON serializable

  @fake @live
  Scenario: A non-zero exit is recoverable model-visible data
    Given an existing Sprite named "acceptance-tools"
    When the model executes a program that writes "bad input" to stderr and exits 7
    Then the tool result has ok false
    And the error code is "command_failed"
    And the error is not retryable
    And the tool data has exit code 7
    And stderr contains "bad input"
    And the tool call does not reject with a JavaScript exception

  @fake @live
  Scenario: Files persist between independently created tool sets
    Given an existing Sprite named "acceptance-tools"
    And a first Sprite tool set for cwd "/workspace"
    When the first tool set writes "persistent" to "notes/result.txt"
    And I discard the first tool set
    And I create a second tool set for the same Sprite and cwd
    Then reading "notes/result.txt" returns "persistent"

  @mvp @fake
  Scenario: Approval configuration is attached to the selected tool
    Given an existing Sprite named "acceptance-tools"
    When I require approval for "exec"
    Then the "sprite_exec" OpenRouter tool requires approval
    And tools without approval configuration do not require approval
