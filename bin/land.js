#!/usr/bin/env node

'use strict';

const childProcess = require('child_process');
const https = require('https');

const arg = process.argv.slice(2);
const landedBranch = arg[0];

const differCommits = () =>
  parseInt(childProcess.execSync(`git rev-list --count master..HEAD`));

const supportCommits = () => {
  const git = childProcess.spawn('git', [
    'rebase',
    '-i',
    '--autosquash',
    `HEAD~10`,
  ]);
  process.stdin.setRawMode(true);
  process.stdin.pipe(git.stdin);
  git.stdout.pipe(process.stdout);
  git.stdout.on('close', code => {
    if (code !== 0) {
      process.exit(code);
    }
  });
};

const supportRebase = () => {
  const git = childProcess.spawn('git', [
    'rebase',
    '-i',
    `HEAD~${differCommits()}`,
  ]);
  process.stdin.setRawMode(true);
  process.stdin.pipe(git.stdin);
  git.stdout.pipe(process.stdout);
  git.stdout.on('close', code => {
    if (code !== 0) {
      process.exit(code);
    }
  });
};

const supportSquashAll = () => {
  childProcess.execSync(`git reset --soft HEAD~${differCommits()}`);
  const git = childProcess.spawn('git', ['commit']);
  process.stdin.setRawMode(true);
  process.stdin.pipe(git.stdin);
  git.stdout.pipe(process.stdout);
  git.stdout.on('close', code => {
    if (code !== 0) {
      process.exit(code);
    }
  });
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
  const gitConfig = childProcess.execSync('git config --get remote.origin.url');

  if (arg.includes('--rebase')) supportRebase();

  if (arg.includes('--fix-squash')) supportCommits();

  if (arg.includes('--squash-all')) supportSquashAll();

  const repoName = gitConfig.slice(
    gitConfig.indexOf(':') + 1,
    gitConfig.lastIndexOf('.git')
  );

  const gitLog = childProcess
    .execSync('git log -1 --pretty=format:%B')
    .toString('utf8');
  if (!gitLog.includes('PR-URL')) {
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
      .toString('utf8')
      .split('\n')
      .reverse()
      .join(' ');

    cherryPick(commitsList);
  }
};

getPRURL();
