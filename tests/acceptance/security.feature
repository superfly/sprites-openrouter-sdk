@mvp
Feature: Safe workspace defaults
  As an agent application developer
  I want host state excluded unless I opt in
  So that model-generated commands do not inherit application secrets

  @fake @live
  Scenario: Host environment variables are not inherited
    Given the host environment contains "APPLICATION_SECRET=do-not-copy"
    And the workspace environment is not configured
    When the model executes a program that prints "APPLICATION_SECRET"
    Then the command cannot read value "do-not-copy"

  @fake @live
  Scenario: Explicit workspace environment is available
    Given the workspace environment contains "PUBLIC_BUILD_MODE=test"
    When the model executes a program that prints "PUBLIC_BUILD_MODE"
    Then stdout contains "test"

  @fake @live
  Scenario: Sprites and OpenRouter credentials are not implicitly copied
    Given the host has "SPRITES_TOKEN" and "OPENROUTER_API_KEY"
    And neither variable is in the configured workspace environment
    When the model executes a program that lists its environment
    Then stdout does not contain either host credential value

  @fake @live
  Scenario Outline: Filesystem tools reject traversal outside cwd
    Given filesystem tools configured with cwd "/workspace"
    When the model calls "<tool>" with path "../outside.txt"
    Then the tool result has ok false
    And the error code is "invalid_path"
    And no path outside "/workspace" is mutated

    Examples:
      | tool                  |
      | sprite_read_file      |
      | sprite_write_file     |
      | sprite_apply_patch    |
      | sprite_list_directory |
      | sprite_search_files   |

  @fake
  Scenario: The default network policy is preserved
    Given an existing Sprite with a network policy
    When I open a workspace without a network policy option
    Then no network policy update is requested

  @fake @live
  Scenario: An explicit network policy is applied before use
    Given an existing Sprite
    When I open a workspace with an explicit network policy
    Then that exact network policy is applied before the workspace is returned

  @fake
  Scenario: Foreground commands use an explicit bounded shell
    Given an existing Sprite
    When the model calls "sprite_exec" with command "printf '%s' shell-ok"
    Then the Sprite spawns "sh" with arguments "-lc" and "printf '%s' shell-ok"
    And max run after disconnect is bounded by the command timeout
