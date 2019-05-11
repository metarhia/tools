#!/usr/bin/env node

'use strict';

const childProcess = require('child_process');
const https = require('https');
const path = require('path');

const arg = process.argv.slice(2);
const landedBranch = arg[0];
const toolName = path.basename(process.argv[1]);

const help = `\
This a Pull Request landing tool that will automatically pick up commits from
the branch add metadata to them and merge into the specified branch.

Usage: ${toolName} <landed-branch> [--rebase] [--autosquash] [--squash-all] [--cherry-pick]
       ${toolName} --help

Options:
  --rebase        start interactive rebase of the source branch
  --autosquash    move commits that begin with squash!/fixup! under -i
  --squash-all    apply squash command on all commits (except first) and prompt
                  user for the resulting commit message
  --cherry-pick   apply commits from source branch onto <landed-branch>
  --help          print this help message and exit
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
};

getPRURL();
