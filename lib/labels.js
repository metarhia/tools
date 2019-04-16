'use strict';

const https = require('https');
const metasync = require('metasync');
const querystring = require('querystring');

const request = Symbol('request');
const getPath = Symbol('getPath');

// TODO(SemenchenkoVitaliy): remove when new version of metasync is published
const runIf = (condition, defaultVal, asyncFn, ...args) => {
  if (typeof defaultVal === 'function') {
    args.unshift(asyncFn);
    asyncFn = defaultVal;
    defaultVal = undefined;
  }
  if (condition) {
    asyncFn(...args);
  } else {
    const callback = args[args.length - 1];
    process.nextTick(callback, null, defaultVal);
  }
};

class LabelHandler {
  constructor(options = {}) {
    this.options = options;
  }

  [request](path, method, data, cb) {
    if (typeof data === 'function') {
      cb = data;
      data = undefined;
    }

    const reqOptions = {
      headers: {
        'user-agent': this.options.user,
        authorization: `token ${this.options.token}`,
        accept: 'application/vnd.github.symmetra-preview+json',
      },
      host: 'api.github.com',
      path,
      method,
    };
    const req = https.request(reqOptions, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        const code = res.statusCode;
        if (
          ((method === 'GET' || method === 'PATCH') && code === 200) ||
          (method === 'POST' && code === 201) ||
          (method === 'DELETE' && code === 204)
        ) {
          cb(null, data);
        } else {
          cb(res.statusMessage);
        }
      });
    });
    if (data) req.write(data);
    req.on('error', cb);
    req.end();
  }

  [getPath](repo, labelName) {
    labelName = labelName ? '/' + querystring.escape(labelName) : '';
    return `/repos/${repo}/labels${labelName}`;
  }

  // Get single label or all labels if `labelName` is not specified
  // from `repo`
  //   repo <string> e.g. `repoOwner/repoName`
  //   labelName <string>
  //   cb <function>
  //     err <Error> | <string>
  //     data <Object>
  getFrom(repo, labelName, cb) {
    if (typeof labelName === 'function' || labelName.length === 0) {
      cb = labelName;
      labelName = '';
    }
    this[request](this[getPath](repo, labelName), 'GET', (err, data) => {
      if (err) cb(err);
      else cb(null, JSON.parse(data));
    });
  }

  // Get single label or all labels if `labelName` is not specified
  // from current repository
  //   labelName <string>
  //   cb <function>
  //     err <Error> | <string>
  //     data <Object>
  get(labelName, cb) {
    this.getFrom(this.options.repo, labelName, cb);
  }

  // Create label or labels in `repoOwner/repoName`
  //   repo <string> e.g. `repoOwner/repoName`
  //   label <Object> | <Object[]>
  //     name <string>
  //     color <string>, hexadecimal color code, e.g. f29513
  //     description <string>, optional
  //   cb <function>
  //     err <Error> | <string>
  createIn(repo, label, cb) {
    if (typeof label === 'function') {
      cb = label;
      label = undefined;
    }
    const path = this[getPath](repo);
    if (Array.isArray(label)) {
      metasync.series(
        label,
        (label, cb) => {
          console.log(path, label);
          this[request](path, 'POST', JSON.stringify(label), (err, data) => {
            if (err) cb(err);
            else cb(null, JSON.parse(data));
          });
        },
        cb
      );
    } else {
      this[request](path, 'POST', JSON.stringify(label), (err, data) => {
        if (err) cb(err);
        else cb(null, JSON.parse(data));
      });
    }
  }

  // Create label or labels in current repository
  //   label <Object> | <Object[]>
  //     name <string>
  //     color <string>, hexadecimal color code, e.g. f29513
  //     description <string>, optional
  //   cb <function>
  //     err <Error> | <string>
  create(label, cb) {
    this.createIn(this.options.repo, label, cb);
  }

  // Delete label or labels in `repoOwner/repoName`
  //   repo <string> e.g. `repoOwner/repoName`
  //   labelName <string> | <string[]>, optional, if not specified, all labels
  //       will be deleted
  //   cb <function>
  //     err <Error> | <string>
  deleteIn(repo, labelName, cb) {
    if (typeof labelName === 'function') {
      cb = labelName;
      labelName = undefined;
    }
    runIf(
      !labelName,
      labelName,
      cb => this.getFrom(repo, cb),
      (err, labels) => {
        if (err) {
          cb(err);
          return;
        }
        if (typeof labels === 'string') {
          this[request](this[getPath](repo, labels), 'DELETE', cb);
        } else if (Array.isArray(labels)) {
          metasync.series(
            labels,
            (name, cb) => {
              if (typeof name === 'string') {
                this[request](this[getPath](repo, name), 'DELETE', cb);
              } else {
                this[request](this[getPath](repo, name.name), 'DELETE', cb);
              }
            },
            cb
          );
        }
      }
    );
  }

  // Delete label or labels in current repository
  //   labelName <string> | <string[]>, optional, if not specified, all labels
  //       will be deleted
  //   cb <function>
  //     err <Error> | <string>
  delete(labelName, cb) {
    this.deleteIn(this.options.repo, labelName, cb);
  }

  // Update label in `repoOwner/repoName`
  // Either `labelName` or `label.name` should be specified.
  // Signature: repo, label[, labelName], cb
  //   repo <string> e.g. `repoOwner/repoName`
  //   label <Object>
  //     name <string>
  //     color <string>, hexadecimal color code, e.g. f29513
  //     description <string>
  //   labelName <string>, optional, if not
  //       specified, `label.name` will be used instead
  //   cb <function>
  //     err <Error> | <string>
  updateIn(repo, label, labelName, cb) {
    if (typeof labelName === 'function') {
      cb = labelName;
      labelName = label.name;
    }
    if (!labelName) {
      cb(new Error('Label name was not specified'));
      return;
    }
    this[request](
      this[getPath](repo, labelName),
      'PATCH',
      JSON.stringify(label),
      (err, data) => {
        if (err) cb(err);
        else cb(null, JSON.parse(data));
      }
    );
  }

  // Update label in current repository
  // Either `labelName` or `label.name` should be specified.
  // Signature: label[, labelName], cb
  //   label <Object>
  //     name <string>
  //     color <string>, hexadecimal color code, e.g. f29513
  //     description <string>
  //   labelName <string>, optional, if not
  //       specified, `label.name` will be used instead
  //   cb <function>
  //     err <Error> | <string>
  update(label, labelName, cb) {
    this.updateIn(this.options.repo, label, labelName, cb);
  }

  // Copy labels from `repoOwner/repoName` to current repository
  //   repo <string> | <Object> | <Object[]>
  //   updateExistingLabels <boolean>
  //   cb <function>
  //     err <Error> | <string>
  copyFrom(repo, updateExistingLabels, cb) {
    runIf(
      typeof repo === 'string',
      repo,
      cb => this.getFrom(repo, cb),
      (err, labels) => {
        if (err) {
          cb(err);
          return;
        }
        if (!Array.isArray(labels)) labels = [labels];
        this.get((err, curLabels) => {
          if (err) {
            cb(err);
            return;
          }
          curLabels = new Set(curLabels.map(label => label.name));
          metasync.series(
            labels,
            (label, cb) => {
              if (curLabels.has(label.name)) {
                if (updateExistingLabels) this.update(label, cb);
              } else {
                this.create(label, cb);
              }
            },
            cb
          );
        });
      }
    );
  }

  // Copy labels from current repository to `repoOwner/repoName`
  //   repo <string> | <Object> | <Object[]>
  //   updateExistingLabels <boolean>
  //   cb <function>
  //     err <Error> | <string>
  copyTo(repo, updateExistingLabels, cb) {
    runIf(typeof repo === 'string', repo, this.get, (err, labels) => {
      if (err) {
        cb(err);
        return;
      }
      if (!Array.isArray(labels)) labels = [labels];

      this.getFrom(repo, (err, curLabels) => {
        if (err) {
          cb(err);
          return;
        }
        curLabels = new Set(curLabels.map(label => label.name));
        metasync.series(
          labels,
          (label, cb) => {
            if (curLabels.has(label.name)) {
              if (updateExistingLabels) {
                this.updateIn(repo, label, cb);
              }
            } else {
              this.createIn(repo, label, cb);
            }
          },
          cb
        );
      });
    });
  }
}

module.exports = { LabelHandler, runIf };
