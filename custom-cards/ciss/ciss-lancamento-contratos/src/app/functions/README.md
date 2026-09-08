## Using NPM dependencies

To add dependencies for these serverless functions, declare them in the local `package.json` file under `dependencies`. When the app is built, those dependencies are bundled with the function code.

Only document and install packages that are actually required by this function package. If a new dependency is needed, add it to `package.json` and import or require it from the function where it is used.

Example:

```json
{
{
 "dependencies": {
    "your-package-name": "^1.0.0"
  }
}
}
```
