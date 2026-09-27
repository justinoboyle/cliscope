# Writing rules

Use the language of a Unix command manual: state the operation, input, output,
and defaults before exceptions. Describe observable behavior with the exact
implemented names. Distinguish stored entries from invocations and execution.

- Start option descriptions with an imperative verb. Give units and accepted
  values where they affect use; [CLI help](../src/options.ts) owns the flag reference.
- Keep reports focused on results. Put counting or scale explanations beside
  the affected output; put implementation details in developer documentation.
- Write diagnostics as `cliscope: cause`, followed by a concrete correction when
  known. Omit slogans, promotion, praise, and unsupported correctness claims.
- Keep the README short: name, purpose, runnable npx commands, Node requirement,
  examples, and links. The [manual](manual.md) owns user semantics and limits;
  [releases](releases.md) owns publication and recovery.
- Start PR descriptions with the problem and resulting behavior, not a “Change”
  heading. Add structure only when it helps scanning.
- Use consistent terms and plain sentences. Distinguish observed evidence from
  intended behavior and untested assumptions.
- Keep examples runnable. Put explanations outside shell blocks, with no aligned
  inline comments. Follow the [security policy](../SECURITY.md) for sample data.
- Keep each rule or procedure in one home and link to it. Link to configuration
  for executable settings rather than copying values into prose. Preserve required
  upstream license text verbatim.
