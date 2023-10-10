# eslint-plugin-compile

eslint for compilejs it is a tools for compiling ts into programming languages.

## Installation

You'll first need to install [ESLint](https://eslint.org/):

```sh
npm i eslint --save-dev
```

Next, install `eslint-plugin-compile`:

```sh
npm install eslint-plugin-compile --save-dev
```

## Usage

Add `compile` to the plugins section of your `.eslintrc` configuration file. You can omit the `eslint-plugin-` prefix:

```json
{
    "plugins": [
        "compile"
    ]
}
```


Then configure the rules you want to use under the rules section.

```json
{
    "rules": {
        "compile/rule-name": 2
    }
}
```

## Rules

<!-- begin auto-generated rules list -->
TODO: Run eslint-doc-generator to generate the rules list.
<!-- end auto-generated rules list -->


