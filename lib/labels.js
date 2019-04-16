'use strict';

const https = require('https');
const metasync = require('metasync');
const querystring = require('querystring');

const request = Symbol('request');
const getPath = Symbol('getPath');

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

  [getPath](repoOwner, repoName, labelName) {
    labelName = labelName ? '/' + querystring.escape(labelName) : '';
    return `/repos/${repoOwner}/${repoName}/labels${labelName}`;
  }

  // Get single label or all labels if `labelName` is not specified
  // from `repoOwner/repoName`
  //   repoOwner <string>
  //   repoName <string>
  //   labelName <string>
  //   cb <function>
  //     err <Error> | <string>
  //     data <Object>
  getFrom(repoOwner, repoName, labelName, cb) {
    if (typeof labelName === 'function' || labelName.length === 0) {
      cb = labelName;
      labelName = '';
    }
    this[request](
      this[getPath](repoOwner, repoName, labelName),
      'GET',
      (err, data) => {
        if (err) cb(err);
        else cb(null, JSON.parse(data));
      }
    );
  }

  // Get single label or all labels if `labelName` is not specified
  // from current repository
  //   labelName <string>
  //   cb <function>
  //     err <Error> | <string>
  //     data <Object>
  get(labelName, cb) {
    this.getFrom(this.options.repoOwner, this.options.repoName, labelName, cb);
  }

  // Create label or labels in `repoOwner/repoName`
  //   repoOwner <string>
  //   repoName <string>
  //   label <Object> | <Object[]>
  //     name <string>
  //     color <string>, hexadecimal color code, e.g. f29513
  //     description <string>, optional
  //   cb <function>
  //     err <Error> | <string>
  createIn(repoOwner, repoName, label, cb) {
    if (typeof label === 'function') {
      cb = label;
      label = undefined;
    }
    const path = this[getPath](repoOwner, repoName);
    if (Array.isArray(label)) {
      metasync.series(
        label,
        (label, cb) => {
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
    this.createIn(this.options.repoOwner, this.options.repoName, label, cb);
  }

  // Delete label or labels in `repoOwner/repoName`
  //   repoOwner <string>
  //   repoName <string>
  //   labelName <string> | <string[]>, optional, if not specified, all labels
  //       will be deleted
  //   cb <function>
  //     err <Error> | <string>
  deleteIn(repoOwner, repoName, labelName, cb) {
    if (typeof labelName === 'function') {
      cb = labelName;
      labelName = undefined;
    }
    if (typeof labelName === 'string') {
      this[request](
        this[getPath](repoOwner, repoName, labelName),
        'DELETE',
        cb
      );
    } else if (Array.isArray(labelName)) {
      metasync.series(
        labelName,
        (name, cb) => {
          this[request](this[getPath](repoOwner, repoName, name), 'DELETE', cb);
        },
        cb
      );
    } else {
      this.getFrom(repoOwner, repoName, (err, labels) => {
        if (err) {
          cb(err);
          return;
        }
        metasync.series(
          labels,
          ({ name }, cb) => {
            this[request](
              this[getPath](repoOwner, repoName, name),
              'DELETE',
              err => {
                cb(err);
              }
            );
          },
          cb
        );
      });
    }
  }

  // Delete label or labels in current repository
  //   labelName <string> | <string[]>, optional, if not specified, all labels
  //       will be deleted
  //   cb <function>
  //     err <Error> | <string>
  delete(labelName, cb) {
    this.deleteIn(this.options.repoOwner, this.options.repoName, labelName, cb);
  }

  // Update label in `repoOwner/repoName`
  // Either `labelName` or `label.name` should be specified.
  // Signature: repoOwner, repoName, label[, labelName], cb
  //   repoOwner <string>
  //   repoName <string>
  //   label <Object>
  //     name <string>
  //     color <string>, hexadecimal color code, e.g. f29513
  //     description <string>
  //   labelName <string>, optional, if not
  //       specified, `label.name` will be used instead
  //   cb <function>
  //     err <Error> | <string>
  updateIn(repoOwner, repoName, label, labelName, cb) {
    if (typeof labelName === 'function') {
      cb = labelName;
      labelName = label.name;
    }
    if (!labelName) {
      cb(new Error('Label name was not specified'));
      return;
    }
    this[request](
      this[getPath](repoOwner, repoName, labelName),
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
    this.updateIn(
      this.options.repoOwner,
      this.options.repoName,
      label,
      labelName,
      cb
    );
  }

  // Copy labels from `repoOwner/repoName` to current repository
  //   repoOwner <string>
  //   repoName <string>
  //   updateExistingLabels <boolean>
  //   cb <function>
  //     err <Error> | <string>
  copyFrom(repoOwner, repoName, updateExistingLabels, cb) {
    this.getFrom(repoOwner, repoName, (err, labels) => {
      if (err) {
        cb(err);
        return;
      }
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
    });
  }

  // Copy labels from current repository to `repoOwner/repoName`
  //   repoOwner <string>
  //   repoName <string>
  //   updateExistingLabels <boolean>
  //   cb <function>
  //     err <Error> | <string>
  copyTo(repoOwner, repoName, updateExistingLabels, cb) {
    this.get((err, labels) => {
      if (err) {
        cb(err);
        return;
      }
      this.getFrom(repoOwner, repoName, (err, curLabels) => {
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
                this.updateIn(repoOwner, repoName, label, cb);
              }
            } else {
              this.createIn(repoOwner, repoName, label, cb);
            }
          },
          cb
        );
      });
    });
  }
}

module.exports = { LabelHandler };
