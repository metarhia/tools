#!/usr/bin/env node

'use strict';

const childProcess = require('child_process');
const https = require('https');
const path = require('path');
const util = require('util');

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
  --squash-all    apply squash command on all commits (except first) and prompt
                  user for the resulting commit message
  --cherry-pick   apply commits from source branch onto <target-branch>
  --landed        allow to automatically comment Landed in ... in the PR
  --push          push last commit into <target-branch>
  --merge         merge branch into <target-branch>
  --help          print this help message and exit
  --version       print version and exit
`;

const runGit = async function(options) {
  const git = await childProcess.spawn('git', options, { stdio: 'inherit' });
  git.on('close', code => {
    if (code !== 0) {
      process.exit(code);
    }
  });
};

async function differCommits() {
  const { stdout, stderr } = await exec(`git rev-list --count master..HEAD`);
  if (stderr) {
    console.error(stderr);
    process.exit(1);
  }

  return parseInt(stdout.trim());
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

(async () => {
  if (arg.includes('--squash-all')) {
    childProcess.exec(`git reset --soft HEAD~${await differCommits()}`, err => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
    });
    runGit(['commit']);
  }
})();

async function getRepoName() {
  let name;
  arg.forEach(value => {
    if (value.startsWith('--remote-name=')) {
      name = value.split('=')[1];
    }
  });

  const { stdout, stderr } = await exec(`git remote get-url ${name}`);
  if (stderr) {
    console.error(stderr);
    process.exit(1);
  }

  const gitConfig = stdout.trim();
  return gitConfig.slice(
    gitConfig.indexOf(':') + 1,
    gitConfig.lastIndexOf('.git')
  );
}

async function gitLog() {
  const { stdout, stderr } = await exec('git log -1 --pretty=format:%B');

  if (stderr) {
    console.error(stderr);
    process.exit(1);
  }

  return stdout.trim();
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

async function commitsList() {
  const { stdout, stderr } = await exec(
    `git log -${await differCommits()} --pretty=format:%h`
  );
  if (stderr) {
    console.error(stderr);
    process.exit(1);
  }
  return stdout
    .split('\n')
    .reverse()
    .join(' ');
}

(async () => {
  if (arg.includes('--cherry-pick')) {
    onLandedBranch();
    childProcess.exec(`git cherry-pick ${await commitsList()}`, err => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
    });
  }
})();

async function getIssueNumber() {
  const { stdout, stderr } = await exec('git log -1 --pretty=format:%B');

  if (stderr) {
    console.error(stderr);
    process.exit(1);
  }

  return parseInt(path.basename(stdout).trim());
}

async function lastCommitHash() {
  const { stdout, stderr } = await exec('git log -1 --pretty=format:%h');

  if (stderr) {
    console.error(stderr);
    process.exit(1);
  }

  return stdout;
}

(async () => {
  if (arg.includes('--landed')) {
    let user, token;
    arg.forEach(value => {
      if (value.startsWith('--user=')) {
        user = value.split('=')[1];
      }

      if (value.startsWith('--token=')) {
        token = value.split('=')[1];
      }
    });

    const postData = JSON.stringify({
      body: `Landed in ${await lastCommitHash()}`,
    });

    const options = {
      host: 'api.github.com',
      method: 'POST',
      path: `/repos/${await getRepoName()}/issues/${await getIssueNumber()}/comments`,
      headers: {
        'user-agent': `${user}`,
        accept: 'application/vnd.github.v3+json',
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
})();

async function isLandedBranch() {
  const { stdout, stderr } = await exec(`git rev-parse --abbrev-ref HEAD`);
  if (stderr) {
    console.error(stderr);
    process.exit(1);
  }
  const currentBranch = stdout.trim();
  if (currentBranch !== landedBranch) {
    onLandedBranch();
  }
}

if (arg.includes('--push')) {
  isLandedBranch();
  childProcess.exec('git push', err => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
  });
}

(async () => {
  if (arg.includes('--merge')) {
    isLandedBranch();
    runGit(['merge', `${await lastCommitHash()}`]);
  }
})();
