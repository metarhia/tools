#!/usr/bin/env node

'use strict';

const childProcess = require('child_process');
const https = require('https');
const path = require('path');

const arg = process.argv.slice(2);
const landedBranch = arg[0];
const toolName = path.basename(process.argv[1]);
const toolVersion = require('../package.json').version;

const help = `\
This a Pull Request landing tool that will automatically pick up commits from
the branch add metadata to them and merge into the specified branch.

Usage: ${toolName} <landed-branch> [OPTION]
       ${toolName} --help
       ${toolName} --version

Options:
  --user          GitHub username
  --token         GitHub access token
  --rebase        start interactive rebase of the source branch
  --autosquash    move commits that begin with squash!/fixup! under -i
  --squash-all    apply squash command on all commits (except first) and prompt
                  user for the resulting commit message
  --cherry-pick   apply commits from source branch onto <landed-branch>
  --landed        allow to automatically comment Landed in ... in the PR
  --push          push last commit into specified branch
  --merge         merge last commit into specified branch
  --help          print this help message and exit
  --version       print version and exit
`;

const differCommits = () =>
  parseInt(childProcess.execSync(`git rev-list --count master..HEAD`));

const userInteraction = options => {
  const git = childProcess.spawn('git', options);
  process.stdin.setRawMode(true);
  process.stdin.pipe(git.stdin);
  git.stdout.pipe(process.stdout);
  git.stdout.on('close', code => {
    if (code !== 0) {
      process.exit(code);
    }
  });
};

const supportCommits = () => {
  userInteraction(['rebase', '-i', '--autosquash', `HEAD~${differCommits()}`]);
};

const supportRebase = () => {
  userInteraction(['rebase', '-i', `HEAD~${differCommits()}`]);
};

const supportSquashAll = () => {
  childProcess.execSync(`git reset --soft HEAD~${differCommits()}`);
  userInteraction(['commit']);
};

const supportMerge = lastCommitHash => {
  userInteraction(['merge', `${lastCommitHash}`]);
};

const cherryPick = commitsList => {
  childProcess.execSync(`git checkout ${landedBranch}`);
  childProcess.execSync(`git cherry-pick ${commitsList}`);
};

const httpsGet = (commitMessage, options) => {
  https
    .get(options, res => {
      let data = '';
      res.setEncoding('utf8');

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        const prUrl = JSON.parse(data).items[0].html_url;

        const extendedCommit = `${commitMessage}\n\nPR-URL: ${prUrl}`;
        childProcess.execSync(
          `git commit --amend --message='${extendedCommit}'`
        );
      });
    })
    .on('error', err => {
      console.error(err);
      process.exit(1);
    });
};

const getPRURL = () => {
  if (arg.includes('--help') || arg.includes('-h')) {
    console.log(help);
    process.exit(0);
  } else if (arg.includes('--version')) {
    console.log(toolVersion);
    process.exit(0);
  }

  if (arg.includes('--rebase')) supportRebase();

  if (arg.includes('--autosquash')) supportCommits();

  if (arg.includes('--squash-all')) supportSquashAll();

  const gitConfig = childProcess
    .execSync('git config --get remote.origin.url')
    .toString();

  const repoName = gitConfig.slice(
    gitConfig.indexOf(':') + 1,
    gitConfig.lastIndexOf('.git')
  );

  const gitLog = childProcess
    .execSync('git log -1 --pretty=format:%B')
    .toString();
  if (!gitLog.includes('PR-URL:')) {
    const options = {
      path: `/search/issues?q=repo:${repoName}+is:pr+head:${landedBranch}`,
      headers: {
        'User-Agent': 'request',
      },
      host: 'api.github.com',
    };

    httpsGet(gitLog, options);
  }

  if (arg.includes('--cherry-pick')) {
    const commitsList = childProcess
      .execSync(`git log -${differCommits()} --pretty=format:%h`)
      .toString()
      .split('\n')
      .reverse()
      .join(' ');

    cherryPick(commitsList);
  }

  const lastCommitHash = childProcess
    .execSync('git log -1 --pretty=format:%h')
    .toString();

  if (arg.includes('--landed')) {
    let user, token;
    if (arg.startsWith('--user=')) {
      user = arg.split('=')[1];
    }

    if (arg.startsWith('--token=')) {
      token = arg.split('=')[1];
    }

    const postData = JSON.stringify({ body: `Landed in ${lastCommitHash}` });

    const getIssueNumber = () => {
      const issueNumber = childProcess
        .execSync('git log -1 --pretty=format:%B')
        .toString();
      return path.basename(issueNumber).replace('\n', '');
    };

    const options = {
      host: 'api.github.com',
      method: 'POST',
      path: `/repos/${repoName}/issues/${getIssueNumber()}/comments`,
      headers: {
        'User-Agent': `${user}`,
        accept: 'application/vnd.github.symmetra-preview+json',
        authorization: `token ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options);
    req.on('error', err => {
      console.error(err);
      process.exit(1);
    });
    req.write(postData);
    req.end();
  }

  const isLandedBranch = () => {
    const currentBranch = childProcess
      .execSync(`git rev-parse --abbrev-ref HEAD`)
      .toString()
      .replace('\n', '');
    if (currentBranch !== landedBranch) {
      childProcess.execSync(`git checkout ${landedBranch}`);
    }
  };

  if (arg.includes('--push')) {
    isLandedBranch();
    childProcess.execSync('git push');
  }

  if (arg.includes('--merge')) {
    isLandedBranch();
    supportMerge(lastCommitHash);
  }
};

getPRURL();
