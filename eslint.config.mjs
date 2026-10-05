export default [{
    files: ['src/**/*.js', 'js/finance-*.js', 'functions/**/*.cjs', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: Object.fromEntries('require exports module fetch AbortSignal structuredClone TextEncoder crypto document sessionStorage confirm Blob URL setTimeout console CustomEvent process __FINZ_TEST__ window localStorage prompt alert navigator location requestAnimationFrame'.split(' ').map(name => [name, 'readonly'])) },
    rules: { 'no-undef': 'error', 'no-duplicate-case': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-constant-binary-expression': 'error', 'no-debugger': 'error', 'no-eval': 'error', 'no-implied-eval': 'error' }
}];
