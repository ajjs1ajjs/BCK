module.exports = function(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  let hasModifications = false;

  // Find all CallExpressions like db.prepare(...).run/get/all(...)
  root.find(j.CallExpression, {
    callee: {
      type: 'MemberExpression',
      property: {
        type: 'Identifier'
      },
      object: {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: { name: 'db' },
          property: { name: 'prepare' }
        }
      }
    }
  }).forEach(path => {
    const propName = path.value.callee.property.name;
    if (['get', 'all', 'run'].includes(propName)) {
      // Check if it's already awaited
      const parent = path.parentPath.value;
      if (parent.type !== 'AwaitExpression') {
        hasModifications = true;
        
        // Wrap with await
        j(path).replaceWith(j.awaitExpression(path.value));
        
        // Traverse up and make enclosing function async
        let current = path;
        while (current.parentPath) {
          current = current.parentPath;
          if (
            current.value.type === 'FunctionExpression' ||
            current.value.type === 'ArrowFunctionExpression' ||
            current.value.type === 'FunctionDeclaration'
          ) {
            current.value.async = true;
            break;
          }
        }
      }
    }
  });

  return hasModifications ? root.toSource() : null;
};
