/* eslint-disable */
module.exports = {
    extends: ['plugin:@typescript-eslint/recommended'],
    plugins: [
        "@compile"
    ],
    rules: {
        '@compile/explicit-number-type': 'error'
    }
}
