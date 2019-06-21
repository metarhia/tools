'use strict';

const https = require('https');

const request = Symbol('request');
const getPath = Symbol('getPath');
const getWithPaging = Symbol('getWithPaging');

const parseLinkHeader = link => {
  const parsedLinks = link
    .split(',')
    .map(s => s.split(';'))
    .map(([url, rel]) => [rel.trim().slice(5, -1), url.trim().slice(1, -1)]);
  return new Map(parsedLinks);
};

class LabelHandler {
  constructor(options = {}) {
    this.options = options;
  }

  async [request](path, method, data) {
    const reqOptions = {
      headers: {
        'user-agent': this.options.user,
        authorization: `token ${this.options.token}`,
      },
      host: 'api.github.com',
      path,
      method,
    };
    return new Promise((resolve, reject) => {
      const req = https.request(reqOptions, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (data += chunk));
        res.once('end', () => {
          const code = res.statusCode;
          if (
            ((method === 'GET' || method === 'PATCH') && code === 200) ||
            (method === 'POST' && code === 201) ||
            (method === 'DELETE' && code === 204)
          ) {
            resolve({ data, headers: res.headers });
          } else {
            const err =
              `${method} request to '${path}' ` +
              `returned '${res.statusMessage}'`;
            reject(err);
          }
        });
      });
      if (data) req.write(data);
      req.once('error', reject);
      req.end();
    });
  }

  async [getWithPaging](path) {
    const result = [];
    path += `${path.includes('?') ? '&' : '?'}per_page=100`;
    while (path) {
      const { data, headers } = await this[request](path, 'GET');
      result.push(...JSON.parse(data));

      if (!headers.link) break;
      path = parseLinkHeader(headers.link).get('next');
    }
    return result;
  }

  [getPath](repo, labelName = '') {
    if (labelName) labelName = `/${encodeURIComponent(labelName)}`;
    return `/repos/${repo}/labels${labelName}`;
  }

  // Get single label or all labels if `labelName` is not specified
  // from `repo`
  //   repo <string> e.g. `repoOwner/repoName`
  //   labelName <string>
  // Returns: <Promise>
  async getFrom(repo, labelName) {
    const path = this[getPath](repo, labelName);
    if (labelName) {
      const { data } = await this[request](path, 'GET');
      return JSON.parse(data);
    }
    return this[getWithPaging](path);
  }

  // Get single label or all labels if `labelName` is not specified
  // from current repository
  //   labelName <string>
  // Returns: <Promise>
  async get(labelName) {
    return this.getFrom(this.options.repo, labelName);
  }

  // Create label or labels in `repoOwner/repoName`
  //   repo <string> e.g. `repoOwner/repoName`
  //   label <Object> | <Object[]>
  //     name <string>
  //     color <string>, hexadecimal color code, e.g. f29513
  //     description <string>, optional
  // Returns: <Promise>
  async createIn(repo, label) {
    const path = this[getPath](repo);
    if (Array.isArray(label)) {
      return Promise.all(
        label.map(label => this[request](path, 'POST', JSON.stringify(label)))
      ).map(({ data }) => JSON.parse(data));
    } else {
      const { data } = await this[request](path, 'POST', JSON.stringify(label));
      return JSON.parse(data);
    }
  }

  // Create label or labels in current repository
  //   label <Object> | <Object[]>
  //     name <string>
  //     color <string>, hexadecimal color code, e.g. f29513
  //     description <string>, optional
  // Returns: <Promise>
  async create(label) {
    return this.createIn(this.options.repo, label);
  }

  // Get used labels from `repo`
  //   repo <string> e.g. `repoOwner/repoName`
  // Returns: <Promise>
  async getUsedLabels(repo) {
    const data = await this[getWithPaging](`/repos/${repo}/issues?state=all`);
    const result = new Map();
    data.forEach(issue =>
      issue.labels.forEach(label => {
        const name = encodeURIComponent(label.name).replace(/%22/g, '%5C"');
        if (!result.has(name)) {
          result.set(
            name,
            `https://github.com/${repo}/issues?q=label%3A"${name}"`
          );
        }
      })
    );
    return result;
  }

  // Delete label or labels in `repoOwner/repoName`
  //   repo <string> e.g. `repoOwner/repoName`
  //   labelName <string> | <string[]>, optional, if not specified, all labels
  //       will be deleted
  // Returns: <Promise>
  async deleteIn(repo, labelName) {
    if (!labelName) {
      labelName = (await this.getFrom(repo)).map(label => label.name);
    }
    if (!Array.isArray(labelName)) labelName = [labelName];

    const usedLabels = await this.getUsedLabels(repo);
    labelName = labelName.filter(name => !usedLabels.has(name));

    await Promise.all(
      labelName.map(name => this[request](this[getPath](repo, name), 'DELETE'))
    );
    return usedLabels;
  }

  // Delete label or labels in current repository
  //   labelName <string> | <string[]>, optional, if not specified, all labels
  //       will be deleted
  // Returns: <Promise>
  async delete(labelName) {
    return this.deleteIn(this.options.repo, labelName);
  }

  // Update label in `repoOwner/repoName`
  // Either `labelName` or `label.name` should be specified.
  // Signature: repo, label[, labelName]
  //   repo <string> e.g. `repoOwner/repoName`
  //   label <Object>
  //     name <string>
  //     color <string>, hexadecimal color code, e.g. f29513
  //     description <string>
  //   labelName <string>, optional, if not
  //       specified, `label.name` will be used instead
  // Returns: <Promise>
  async updateIn(repo, label, labelName) {
    if (!labelName) labelName = label.name;
    if (!labelName) {
      return Promise.reject(new Error('Label name was not specified'));
    }
    const { data } = await this[request](
      this[getPath](repo, labelName),
      'PATCH',
      JSON.stringify(label)
    );
    return JSON.parse(data);
  }

  // Update label in current repository
  // Either `labelName` or `label.name` should be specified.
  // Signature: label[, labelName]
  //   label <Object>
  //     name <string>
  //     color <string>, hexadecimal color code, e.g. f29513
  //     description <string>
  //   labelName <string>, optional, if not
  //       specified, `label.name` will be used instead
  // Returns: <Promise>
  async update(label, labelName) {
    return this.updateIn(this.options.repo, label, labelName);
  }

  // Copy labels from `repoOwner/repoName` to current repository
  //   labels <Object> | <Object[]> | <string> labels or repo
  //   updateExistingLabels <boolean>
  // Returns: <Promise>
  async copyFrom(labels, updateExistingLabels) {
    if (typeof labels === 'string') labels = await this.getFrom(labels);
    if (!Array.isArray(labels)) labels = [labels];
    const curLabels = new Map(
      (await this.get()).map(label => [label.name, label])
    );

    labels = await Promise.all(
      labels.map(label => {
        if (curLabels.has(label.name)) {
          if (updateExistingLabels) return this.update(label);
          return Promise.resolve(null);
        } else {
          return this.create(label);
        }
      })
    );
    return labels.filter(label => label);
  }

  // Copy labels from current repository to `repoOwner/repoName`
  //   repo <string>
  //   updateExistingLabels <boolean>
  //   labels <Object> | <Object[]> optional, labels to copy, if not specified
  //       labels from current repo will be used
  // Returns: <Promise>
  async copyTo(repo, updateExistingLabels, labels) {
    if (!labels) labels = await this.get();
    if (!Array.isArray(labels)) labels = [labels];
    const curLabels = new Map(
      (await this.getFrom(repo)).map(label => [label.name, label])
    );

    labels = await Promise.all(
      labels.map(label => {
        if (curLabels.has(label.name)) {
          if (updateExistingLabels) return this.updateIn(repo, label);
          return Promise.resolve(null);
        } else {
          return this.createIn(repo, label);
        }
      })
    );

    return labels.filter(label => label);
  }
}

module.exports = { LabelHandler };
