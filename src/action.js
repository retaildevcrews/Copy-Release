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
    tagName = core.getInput('tag_name', { required: false }),
    githubToken = process.env.GITHUB_TOKEN,
    octokit = GitHub.getOctokit(githubToken),
    context = GitHub.context,
    { owner: currentOwner, repo: currentRepo } = context.repo,
    getRepo = core.getInput('repo', { required: false }) || currentOwner + "/" + currentRepo,
    owner = getRepo.match(/^[\s\w]+(?=\/)/g)[0],
    repo = getRepo.match(/[^\/][\d\w-]+$/g)[0]

var 
    releaseName = core.getInput('release_name', { required: false }).replace('refs/tags/', ''),
    body = core.getInput('body', { required: false }),
    tag = tagName.replace('refs/tags/', '')
    assetArray = [], bodyFileContent, releaseAsset, uploadUrl

core.info(format('tag_name:%s, owner:%s, repo:%s', tagName, owner, repo))

Main()

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

//API: ttps://octokit.github.io/rest.js/v18#repos-get-release-by-tag
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

    core.info('GetLatestRelease Done')
}

//API: https://octokit.github.io/rest.js/v18#repos-get-latest-release
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

async function ProcessRelease(release) {
    const {
        data: { tag_name: t, name: n, body: b }
    } = release
    releaseAsset = release.data.assets || ''
    core.info(format('tag:%s, name:%s, body:%s', latestTag, latestName, latestBody))

    tag = t
    releaseName = n
    body = b
}

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

//API: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
async function CreateRelease() {
    core.info('CreateRealease Start')
    let createReleaseResponse = await octokit.repos.createRelease({
        owner,
        repo,
        tag_name: tag,
        name: releaseName,
        body: bodyFileContent || body,
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

async function DecodeAssetFile() {
    core.info('DecodeAssetFile Start')
    let dir
    try {
        dir = fs.readdirSync(assetFile)
    } catch (err) {
        core.debug(err)
        switch (err.code) {
            case 'ENOENT':
                core.info(assetFile + ' not exists')
                break
            case 'ENOTDIR':
                core.info(assetFile + ' exists')
                assetArray.push(assetFile)
                break
            default:
                core.error(err)
                break
        }
    }
    if (dir) {
        dir.forEach((val) => {
            let subFile = path.join(assetFile, val)
            if (!fs.statSync(subFile).isDirectory())
                assetArray.push(subFile)
        })
    }
    core.info('DecodeAssetFile Done')
}

//API: https://octokit.github.io/rest.js/v16#repos-upload-release-asset
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
            format('content-type:%s,\ncontent-length:%s,\nupload_url:%s,\nfile_path:%s',
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