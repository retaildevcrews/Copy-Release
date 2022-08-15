# Copy-Release

Copy a release to another repository.

Forked from [Release-AIO](https://github.com/Hs1r1us/Release-AIO) under the MIT [license](LICENCSE) to provide more control over copying a specific release.

The original `Release-AIO` action referenced [`@actions/create-release`](https://github.com/marketplace/actions/create-a-release) [`@actions/upload-release-asset`](https://github.com/marketplace/actions/upload-a-release-asset).

Copy-Release builds dist as in [this spacejelly tutorial](https://spacejelly.dev/posts/how-to-create-a-custom-github-action-with-node-javascript/).

------------

## Usage

### Environments

- `GITHUB_TOKEN`: Set `secrets.GITHUB_TOKEN` to `env.GITHUB_TOKEN`, ***Pay attention set a new secret token when create a release to other repository***

### Inputs

- `tag_name`: The name of the tag for the release to copy

### Outputs

- `id`: The release ID
- `html_url`: The URL users can navigate to in order to view the release
- `upload_url`: The URL for uploading assets to the release

## Examples

### Copy a Specific Release to Another Repo

- Copy a specific Release of the current Repository to the target Repository
  - private_Repo => public_Repo
  - Use in private_Repo
  - [A new token](https://github.com/settings/tokens/new?scopes=repo) to access the target Repository

```yaml
- name: Copy Release to some-repo
  id: Copy-Release
  uses: DanMass/Copy-Relesae@v1.0
  env:
    GITHUB_TOKEN: ${{ secrets.PRIVATE_TOKEN }} # You need a new token to access the target Repository
  with:
    tag_name: 'v1.3.2'
```

### Copy the Latest Release to Another Repo

- Copy the latest Release of the current Repository to the target Repository
  - private_Repo => public_Repo
  - Use in private_Repo
  - [A new token](https://github.com/settings/tokens/new?scopes=repo) to access the target Repository

```yaml
- name: Copy Release to some-repo
  id: Copy-Release
  uses: DanMass/Copy-Relesae@v1.0
  env:
    GITHUB_TOKEN: ${{ secrets.PRIVATE_TOKEN }} # You need a new token to access the target Repository
```
