# Writing rules

Use the language of a Unix command manual for help, diagnostics, reports, and
project documentation. The local `ls(1)`, `grep(1)`, and `cut(1)` manuals provide
the model: state the operation, identify its input and output, and describe
defaults before exceptions.

- Start option descriptions with an imperative verb: “Print,” “Read,” “Select,”
  “Include,” or “Write.” Name an argument's units, accepted values, and default
  when they affect its use.
- Describe observable behavior. State whether a command reads a file, writes to
  standard output, creates an export, or opens a terminal interface. Distinguish
  standard output from standard error and document exit status.
- Use the exact flag, field, filename, and key names implemented by the program.
  Use uppercase argument placeholders in syntax, such as `--history PATH`.
- Keep default reports focused on results. Put explanations of counting rules,
  units, scales, unavailable data, and necessary controls next to the affected
  output. Put installation and implementation details in documentation.
- Write diagnostics as `cliscope: cause` followed by a concrete correction when
  one is known. Avoid blame, apologies, jokes, and guesses about the cause.
- Omit slogans, promotional claims, congratulatory messages, and conversational
  invitations. Do not describe software as excellent, powerful, seamless, or
  formally proven without specific supporting evidence.
- Start the README with the command name, one purpose sentence, and runnable
  `npx cliscope` and `npx cliscope -i` examples. State the Node requirement next.
  Keep the README short; put option, counting, export, installation, and parser
  details in [the manual](manual.md). Do not promote implementation libraries.
- Start pull request descriptions with a sentence describing the change and
  its observable result. Do not put a “Change” heading above that sentence.
  Add headings only where they help readers find required information.
- Prefer short sentences and familiar technical terms. Use one term for each
  concept: a history entry is a stored record; an invocation is a recognized
  command in that record. Do not imply that parsing proves execution.
- State limits where they affect interpretation: UTC dates, undated records,
  skipped shell syntax, truncated views, and unsupported platforms. Distinguish
  a tested behavior from an intended behavior or untested assumption.
- Use examples that can run as written with synthetic data or explicit
  placeholders. Explain destructive or publishing commands in the procedure
  that owns them; do not copy release procedures into unrelated documents.
  Put explanations outside shell examples; avoid aligned inline comments.

Keep each rule and procedure in one maintained location. Link to it from other
documents. Preserve required license text and attribution verbatim.
