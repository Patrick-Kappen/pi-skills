  # Test scripts (test-speed skill); the justfile calls them as `devenv shell -- tests ...`. Not named
  # `test`: inside a shell the builtin `test` would win over the script.
  scripts = {
    tests.description = "Run the test files in parallel, slowest first (optionally paths).";
    tests.exec = ''@TEST@'';
    tests-changed.description = "Run only the tests that cover these files, or every change against the base branch.";
    tests-changed.exec = ''@TEST_CHANGED@'';
    tests-serial.description = "Run the tests one after another (optionally paths).";
    tests-serial.exec = ''@TEST_SERIAL@'';
  };
