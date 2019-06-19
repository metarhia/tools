#!/usr/bin/env node

'use strict';

const childProcess = require('child_process');
const https = require('https');
const path = require('path');
const util = require('util');
const clipboardy = require('clipboardy');

const arg = process.argv.slice(2);
const landedBranch = arg[0];
const toolName = path.basename(process.argv[1]);
const toolVersion = require('../package.json').version;
const exec = util.promisify(childProcess.exec);

const help = `\
This a Pull Request landing tool that will automatically pick up commits from
the branch add metadata to them and merge into the specified branch.

Usage: ${toolName} <target-branch> [OPTION]
       ${toolName} --help
       ${toolName} --version

Options:
  --user          GitHub username
  --token         GitHub access token
  --remote-name   point to the remote repo
  --rebase        start interactive rebase of the source branch
  --autosquash    move commits that begin with squash!/fixup! during rebase
  --merge         merge branch into <target-branch>
  --help          print this help message and exit
  --version       print version and exit
`;

const runGit = async function(options) {
  return new Promise((resolve, reject) => {
    const git = childProcess.spawn('git', options, { stdio: 'inherit' });
    git.on('close', code => {
      if (code !== 0) {
        reject(code);
      }
      resolve(code);
    });
  });
};

async function differCommits() {
  let git;
  try {
    git = await exec(`git rev-list --count master..HEAD`);
  } catch (error) {
    console.error(error);
  }
  return parseInt(git.stdout.trim());
}

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
        childProcess.exec(
          `git commit --amend --message='${extendedCommit}'`,
          err => {
            if (err) {
              console.error(err);
              process.exit(1);
            }
          }
        );
      });
    })
    .on('error', err => {
      console.error(err);
      process.exit(1);
    });
};

if (arg.includes('--help') || arg.includes('-h')) {
  console.log(help);
  process.exit(0);
} else if (arg.includes('--version')) {
  console.log(toolVersion);
  process.exit(0);
}

(async () => {
  if (arg.includes('--rebase')) {
    runGit(['rebase', '-i', `HEAD~${await differCommits()}`]);
  }
})();

(async () => {
  if (arg.includes('--autosquash')) {
    runGit(['rebase', '-i', '--autosquash', `HEAD~${await differCommits()}`]);
  }
})();

async function getRepoName() {
  let name, git;
  arg.forEach(value => {
    if (value.startsWith('--remote-name=')) {
      name = value.split('=')[1];
    }
  });

  try {
    git = await exec(`git remote get-url ${name}`);
  } catch (error) {
    console.error(error);
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
  }

  return git.stdout.trim();
}

(async () => {
  const gitLogBody = await gitLog();

  if (!gitLogBody.includes('PR-URL:')) {
    const options = {
      path: `/search/issues?q=repo:${await getRepoName()}+is:pr+head:${landedBranch}`,
      headers: {
        'user-agent': 'metarhia-api-landing-tool',
      },
      host: 'api.github.com',
    };

    httpsGet(gitLogBody, options);
  }
})();

const onLandedBranch = () =>
  childProcess.exec(`git checkout ${landedBranch}`, err => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  });

(async () => {
  if (arg.includes('--merge')) {
    isLandedBranch();
    runGit(['merge', `${await lastCommitHash()}`]);
  }
})();

async function lastCommitHash() {
  let git;
  try {
    git = await exec('git log -1 --pretty=format:%h');
  } catch (error) {
    console.error(error);
  }
  return git.stdout;
}

async function isLandedBranch() {
  let git;
  try {
    git = await exec(`git rev-parse --abbrev-ref HEAD`);
  } catch (error) {
    console.error(error);
  }

  const currentBranch = git.stdout.trim();
  if (currentBranch !== landedBranch) {
    onLandedBranch();
  }
}

(async () => {
  clipboardy.write(`Landed in ${await lastCommitHash()}`);
  clipboardy.read().then(console.log);
})();
