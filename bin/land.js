#!/usr/bin/env node

'use strict';

const childProcess = require('child_process');
const https = require('https');
const path = require('path');
const util = require('util');
const clipboardy = require('clipboardy');

const args = process.argv.slice(2);
const exec = util.promisify(childProcess.exec);
const targetBranch = args[0] || 'master';
const toolName = path.basename(process.argv[1]);
const toolVersion = require('../package.json').version;

const help = `\
This is a Pull Request landing tool that will automatically pick up commits from
the branch adds metadata to them and merge them into the specified branch.

Usage: ${toolName} <target-branch> [OPTION]
       ${toolName} --help
       ${toolName} --version

Options:
  --remote-name   get name from remote repo
  --rebase        start interactive rebase of the source branch
  --autosquash    move commits that begin with squash!/fixup! during rebase
  --cherry-pick   apply commits from source branch onto <target-branch>
  --clipboardy    print 'Landed in (...commitsHash)'
  --help          print this help message and exit
  --version       print version and exit
`;

const runGit = async function(options) {
  return new Promise((resolve, reject) => {
    const git = childProcess.spawn('git', options, {
      stdio: 'inherit',
      windowsHide: true,
    });
    git.on('close', code => {
      if (code !== 0) {
        reject(new SyntaxError('git exit with exit code !== 0'));
      }
      resolve();
    });
  });
};

async function commitsHash(count) {
  let git;
  try {
    git = await exec(`git log -${count} --pretty=format:%h`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
  return git.stdout;
}

async function differCommits() {
  let git;
  try {
    git = await exec(`git rev-list --count ${targetBranch}..HEAD`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
  return parseInt(git.stdout.trim());
}

async function currentBranch() {
  let git;
  try {
    git = await exec('git rev-parse --abbrev-ref HEAD');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
  return git.stdout.trim();
}

async function httpsGet(sourceBranch, targetBranch) {
  const options = {
    path: `/search/issues?q=repo:${await getRepoName()}+is:pr+is:open+head:${sourceBranch}+base:${targetBranch}`,
    headers: {
      'user-agent': 'metarhia-api-landing-tool',
    },
    host: 'api.github.com',
  };

  return new Promise((resolve, reject) => {
    https
      .get(options, res => {
        let data = '';
        res.setEncoding('utf8');

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          resolve(JSON.parse(data).items[0].html_url);
        });
      })
      .on('error', err => {
        reject(err.message);
      });
  });
}

async function getRepoName() {
  let git,
    name = 'origin';
  for (const value of args) {
    if (value.startsWith('--remote-name=')) {
      name = value.split('=')[1];
    }
  }

  try {
    git = await exec(`git remote get-url ${name}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }

  const gitConfig = git.stdout.trim();

  return gitConfig.slice(
    gitConfig.indexOf(':') + 1,
    gitConfig.lastIndexOf('.git')
  );
}

async function gitLog() {
  let git;
  try {
    git = await exec('git log -1 --pretty=format:%B');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }

  return git.stdout.trim();
}

if (args.includes('--help')) {
  console.log(help);
  process.exit(0);
} else if (args.includes('--version')) {
  console.log(toolVersion);
  process.exit(0);
}

const onTargetBranch = () =>
  childProcess.exec(`git checkout ${targetBranch}`, err => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  });

async function lastCommitHash() {
  let git;
  try {
    git = await exec('git log -1 --pretty=format:%h');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
  return git.stdout;
}

(async () => {
  const sourceBranch = await currentBranch();

  if (args.includes('--rebase')) {
    runGit(['rebase', `origin/${targetBranch}`]);
  }

  if (args.includes('--autosquash')) {
    runGit(['rebase', '-i', '--autosquash', `HEAD~${await differCommits()}`]);
  }

  const commitsCount = await differCommits();
  const differCommitsHash = (await commitsHash(commitsCount)).split('\n');
  const commitsHashArr = new Array();

  let prUrl,
    extendedCommit,
    urlRequest = false;

  for (const hash of differCommitsHash) {
    childProcess.execSync(`git checkout ${hash}`);

    const gitLogBody = await gitLog();

    if (!gitLogBody.includes('PR-URL:')) {
      if (!urlRequest) {
        prUrl = await httpsGet(sourceBranch, targetBranch);
        urlRequest = true;
      }

      extendedCommit = `${gitLogBody}\n\nPR-URL: ${prUrl}`;

      childProcess.execSync(
        `git commit --amend --allow-empty --message='${extendedCommit}'`
      );

      const modifiedCommitsHash = await lastCommitHash();

      childProcess.execSync(`git checkout ${sourceBranch}`);

      childProcess.execSync(`git replace -f ${hash} ${modifiedCommitsHash}`);
      commitsHashArr.push(modifiedCommitsHash);
    }
    commitsHashArr.push(hash);
    childProcess.execSync(`git checkout ${sourceBranch}`);
  }

  if (args.includes('--cherry-pick')) {
    onTargetBranch();
    childProcess.exec(
      `git cherry-pick ${sourceBranch}..${targetBranch}`,
      err => {
        if (err) {
          console.error(err);
          process.exit(1);
        }
      }
    );
  }

  if (args.includes('--clipboardy')) {
    clipboardy.write(`Landed in ${commitsHashArr.join(', ')}`);
    clipboardy.read().then(console.log);
  }
})();
