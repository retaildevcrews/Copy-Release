//https://github.com/actions/toolkit
const core = require('@actions/core')
const GitHub = require('@actions/github')
const io = require('@actions/io')
const { format } = require('util')
const fs = require('fs')
const path = require('path')
//https://github.com/sindresorhus/got
const got = require('got')
//https://github.com/broofa/mime
const { getType } = require('mime')

const 
    octokit = GitHub.getOctokit(githubToken),
    context = GitHub.context,
    { owner: currentOwner, repo: currentRepo } = context.repo,
    githubToken = process.env.GITHUB_TOKEN,
    tagName = core.getInput('tag_name', { required: false }),
    getRepo = core.getInput('repo', { required: false }) || currentOwner + "/" + currentRepo,
    owner = getRepo.match(/^[\s\w]+(?=\/)/g)[0],
    repo = getRepo.match(/[^\/][\d\w-]+$/g)[0]

var 
    tag = tagName.replace('refs/tags/', ''),
    releaseName = '',
    body = '',
    draft = false,
    prerelease = false,
    assetArray = []

core.info(format('tag_name: %s, owner: %s, repo: %s', tagName, owner, repo))

Main()

// Gets either the Release associated with the specified tag or the latest
// Release if no tag is specified and copies it with assets to the other repo.
async function Main() {
    try {

        var ReleasePromise
        if (tag == '') {
            ReleasePromise = GetLatestRelease() // tag, releaseName, body
        } else {
            ReleasePromise = GetReleaseForTag() // tag, releaseName, body
        }

        await Promise.all([ReleasePromise])
        var DownloadPromise = DownloadAssets() // assetArray
        var CreatePromise = CreateRelease() // uploadUrl

        await Promise.all([DownloadPromise, CreatePromise])
            .then(() => UploadAssets())

    } catch (error) {
        core.setFailed(error)
    }
}

// Gets the Release for tag. The action will fail if the tag is not
// found or if there is some other error getting the Release.
//
// GitHub API: https://octokit.github.io/rest.js/v18#repos-get-release-by-tag
async function GetReleaseForTag() {
    core.info('GetReleaseForTag Start')

    let tagRelease = null
    tagRelease = await octokit.repos.getReleaseByTag({
        owner: currentOwner,
        repo: currentRepo,
        tag: tag
    }).catch(err => {
        core.setFailed(err)
        throw new Error(err)
    })

    ProcessRelease(tagRelease)

    core.info('GetReleaseForTag Done')
}

// Gets the Release from the current repo that is marked as Latest.
//
// GitHub API: https://octokit.github.io/rest.js/v18#repos-get-latest-release
async function GetLatestRelease() {
    core.info('GetLatestRelease Start')

    let latestRelease = null
    latestRelease = await octokit.repos.getLatestRelease({
        owner: currentOwner,
        repo: currentRepo
    }).catch(err => {
        core.setFailed(err)
        throw new Error(err)
    })

    ProcessRelease(latestRelease)

    core.info('GetLatestRelease Done')
}

// Destructures the Release payload and assigns the values to vars for use
// in copying the Release and its assets.
async function ProcessRelease(release) {
    const {
        data: { tag_name: t, name: n, body: b, draft: d, prerelease: p }
    } = release
    releaseAsset = release.data.assets || ''
    core.info(format('tag: %s, name: %s, body: %s, draft: %s, prerelease: %s', t, n, b, d, p))

    tag = t
    releaseName = n
    body = b
    draft = d
    prerelease = p
}

// Downloads all of the assets associated with the Release to
// an asset_files directory.
async function DownloadAssets() {
    core.info('DownloadAssets Start')

    let assetDirPath = path.join('.', 'asset_files')
    await io.mkdirP(assetDirPath).catch(err => core.setFailed(err))
    for (var i in releaseAsset) {
        core.info('Download ' + releaseAsset[i].name)

        let filePath = path.join(assetDirPath, releaseAsset[i].name)
        const gotOptions = {
            url: releaseAsset[i].url,
            headers: {
                Accept: 'application/octet-stream',
                Authorization: 'token ' + githubToken
            }
        }
        let writeStream = fs.createWriteStream(filePath)
        let response = got.stream(gotOptions)
        response.pipe(writeStream)
        await new Promise(fulfill => writeStream.on('finish', fulfill))
        let assetSize = fs.statSync(filePath).size
        core.info(
            format('%s file size:%s', path.basename(filePath), assetSize))
        if (assetSize != releaseAsset[i].size) {
            let errorMsg = format('Download Error\n%s size %s => %s', releaseAsset[i].name, releaseAsset[i].size, assetSize)
            throw new Error(errorMsg)
        }
        assetArray.push(filePath)
    }

    core.info('DownloadAssets Done')
}

// Creates the Release on the target repo, adding the Release information to the
// workflow context so that subsequent actions can take actions like uploading
// additional assets.
//
// GitHub API: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
async function CreateRelease() {
    core.info('CreateRealease Start')

    let createReleaseResponse = await octokit.repos.createRelease({
        owner,
        repo,
        tag_name: tag,
        name: releaseName,
        body: body,
        draft,
        prerelease
    }).catch(err => {
        core.setFailed(err)
        throw new Error(err)
    })

    const {
        data: { id: releaseId, html_url: htmlUrl }
    } = createReleaseResponse
    uploadUrl = createReleaseResponse.data.upload_url

    core.setOutput('id', releaseId)
    core.setOutput('html_url', htmlUrl)
    core.setOutput('upload_url', uploadUrl)
    core.info('CreateRelease Done')
}

// Uploads the assets to the Release copy.
//
// GitHub API: https://octokit.github.io/rest.js/v16#repos-upload-release-asset
async function UploadAssets() {
    core.info('UploadAssets Start')

    for (var i in assetArray) {
        core.info('Upload ' + path.basename(assetArray[i]))

        let fileMime = getType(assetArray[i]) || 'application/octet-stream'
        let charset = fileMime.indexOf('text') > -1 ? 'utf-8' : null

        let headers = {
            'content-type': fileMime,
            'content-length': fs.statSync(assetArray[i]).size
        }

        core.debug(
            format('content-type: %s,\ncontent-length: %s,\nupload_url: %s,\nfile_path: %s',
                fileMime, headers['content-length'], uploadUrl, assetArray[i])
        )

        let uploadAssetResponse = await octokit.repos.uploadReleaseAsset({
            url: uploadUrl,
            headers,
            name: path.basename(assetArray[i]),
            data: fs.readFileSync(assetArray[i], charset)
        })

        let {
            data: { browser_download_url: browserDownloadUrl }
        } = uploadAssetResponse;

        core.info(
            format('%s url:%s', path.basename(assetArray[i]), browserDownloadUrl)
        )
    }

    core.info('UploadAssets Done')
}
