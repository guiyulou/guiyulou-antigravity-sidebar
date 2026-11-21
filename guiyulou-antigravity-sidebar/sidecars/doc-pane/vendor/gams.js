// CodeMirror 5 的 GAMS 着色模式（自写的最小版）：行首 * 的注释行、$ontext…$offtext 注释块、行首 $ 指令、引号字符串、数字、常用关键字。
CodeMirror.defineMode('gams', function () {
  const keywords = /^(sets?|parameters?|scalars?|tables?|variables?|equations?|models?|solve|display|alias|options?|loop|if|else|elseif|while|repeat|until|for|abort|put|putclose|files?|positive|negative|binary|integer|free|using|minimizing|maximizing|sum|prod|smax|smin|card|ord|yes|no|inf|na|eps|and|or|not|xor|eq|ne|gt|ge|lt|le|all|singleton|acronyms?|execute_load|execute_unload|execute)\b/i;
  return {
    startState: () => ({ block: false }),
    token: function (stream, state) {
      if (state.block) { if (stream.sol() && stream.match(/^\$offtext/i)) { state.block = false; stream.skipToEnd(); return 'comment'; } stream.skipToEnd(); return 'comment'; }
      if (stream.sol() && stream.match(/^\$ontext/i)) { state.block = true; stream.skipToEnd(); return 'comment'; }
      if (stream.sol() && stream.peek() === '*') { stream.skipToEnd(); return 'comment'; }
      if (stream.sol() && stream.peek() === '$') { stream.skipToEnd(); return 'meta'; }
      if (stream.match(/^"[^"]*"?/) || stream.match(/^'[^']*'?/)) return 'string';
      if (stream.match(/^\d+(\.\d+)?([eE][-+]?\d+)?/)) return 'number';
      if (stream.match(keywords)) return 'keyword';
      if (stream.match(/^[A-Za-z_]\w*/)) return null;
      stream.next(); return null;
    }
  };
});
