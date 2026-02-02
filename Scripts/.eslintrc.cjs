// .eslintrc.cjs
module.exports = {
  root: true,
  extends: ['@playcanvas/eslint-config'],
  env: {
    browser: true,
    es2021: true,
  },
  globals: {
    pc: 'readonly',
  },
};
