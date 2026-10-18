module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2021,
  },
  globals: {
    // Firebase SDK (loaded via CDN script tag)
    firebase: 'readonly',
    // Dexie (loaded via CDN script tag)
    Dexie: 'readonly',
    // jQuery (loaded via CDN script tag)
    jquery: 'readonly',
    $: 'readonly',
    jQuery: 'readonly',
    // html2canvas (loaded via CDN script tag)
    html2canvas: 'readonly',
    // jsPDF (loaded via CDN script tag)
    jsPDF: 'readonly',
    // Chart library if ever used
    Chart: 'readonly',
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-undef': 'error',
    'no-console': 'off',
    'no-eval': 'error',
  },
  overrides: [
    {
      // Legacy monolithic files: functions are defined as window.functionName
      // and called directly — cross-references are expected, not errors.
      files: ['hungrybirdspos/app.js', 'hungrybirdspos/db.js'],
      rules: {
        'no-unused-vars': 'off',
        'no-undef': 'warn',
      },
    },
    {
      files: ['hungrybirdspos/sw.js'],
      rules: {
        'no-unused-vars': 'off',
      },
    },
    {
      files: ['tests/**/*.js'],
      env: {
        node: true,
      },
      globals: {
        vi: 'readonly',
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
      },
    },
  ],
};
