'use strict';

const path = require('path');
const fs = require('fs');

const parseOption = Symbol('parseOption');
const parseArgs = Symbol('parseArgs');
const parseArg = Symbol('parseArg');
const buildHelp = Symbol('buildHelp');
const getVersion = Symbol('getVersion');

const searchFile = (dir, fileName) => {
  if (fileName === undefined) {
    fileName = dir;
    dir = process.cwd();
  }
  let file = path.join(dir, fileName);
  while (!fs.existsSync(file)) {
    const parentDir = path.dirname(dir);
    if (dir === parentDir) return null;
    dir = parentDir;
    file = path.join(dir, fileName);
  }
  return file;
};

const toCamelCase = (str, sep = '-') =>
  str
    .split(sep)
    .map((v, i) =>
      i === 0
        ? v.toLowerCase()
        : v.charAt(0).toUpperCase() + v.substr(1).toLowerCase()
    )
    .join('');

const pad = (str, num) => str + ' '.repeat(num);

class Cli {
  constructor() {
    this.options = new Map();
    this.aliases = new Map();
    this.commands = new Map();
    this.parsedOptions = {};
    this.parsedCommand = null;
    this.usageStr = '';
    this.args = [];

    this.defaultOptions = { type: 'string' };

    this.option('help', {
      description: 'Show help',
      type: 'boolean',
      alias: 'h',
    }).option('version', {
      description: 'Version',
      type: 'boolean',
      alias: 'v',
    });
  }

  [parseArg](type, str) {
    if (type === 'boolean') {
      if (str === undefined || str === 'true') return true;
      return false;
    }
    if (type === 'number') return Number.parseFloat(str) || 0;
    return str;
  }

  [parseOption](name, ...args) {
    let opts;
    if (this.options.has(name)) {
      opts = this.options.get(name);
    } else {
      opts = this.defaultOptions;
    }
    if (opts.type === 'counter') {
      this.parsedOptions[name]++;
    } else if (opts.array) {
      this.parsedOptions[name].push(
        ...args.map(str => this[parseArg](opts.type, str))
      );
    } else {
      this.parsedOptions[name] = this[parseArg](opts.type, args[0]);
      this.args.push(...args.slice(1));
    }
  }

  [parseArgs](args) {
    const parsedArgs = [[]];
    const unparsedArgs = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') {
        unparsedArgs.push(...args.slice(i + 1).filter(arg => arg !== ''));
        break;
      } else if (arg.startsWith('--no-')) {
        const idx = arg.indexOf('=');
        if (idx === -1) parsedArgs.push(['--' + arg.slice(5), 'false'], []);
        else parsedArgs.push(['--' + arg.slice(5, idx), 'false'], []);
      } else if (arg.startsWith('--')) {
        const idx = arg.indexOf('=');
        if (idx === -1) parsedArgs.push([arg]);
        else parsedArgs.push([arg.slice(0, idx), arg.slice(idx + 1)], []);
      } else if (arg.startsWith('-')) {
        parsedArgs.push(
          ...arg
            .slice(1)
            .split('')
            .map(flag => ['-' + flag])
        );
      } else if (arg !== '') {
        if (!this.parsedCommand && this.commands.has(arg)) {
          this.parsedCommand = this.commands.get(arg).exec;
          this.args.push(arg);
          parsedArgs.push([]);
        } else {
          parsedArgs[parsedArgs.length - 1].push(arg);
        }
      }
    }

    for (const argArr of parsedArgs) {
      if (argArr.length === 0) continue;
      if (argArr[0].startsWith('--')) {
        this[parseOption](toCamelCase(argArr[0].slice(2)), ...argArr.slice(1));
      } else if (argArr[0].startsWith('-')) {
        if (this.aliases.has(argArr[0][1])) {
          this[parseOption](this.aliases.get(argArr[0][1]), argArr[1]);
        }
      } else {
        this.args.push(...argArr);
      }
    }
    this.args.push(...unparsedArgs);
    return { ...this.parsedOptions, ...{ args: this.args } };
  }

  [buildHelp]() {
    let help = `${this.usageStr}\n\nOptions:\n`;
    const optionsArr = [];
    let indent = 0;
    for (const [name, opt] of this.options) {
      if (opt.hidden && !this.parsedOptions.showHidden) continue;

      const optionName = `--${name}${opt.alias ? `, -${opt.alias}` : ''}`;
      optionsArr.push([optionName, opt.description, `[${opt.type}]`]);
      if (optionName.length > indent) indent = optionName.length;
    }

    help += optionsArr.reduce((acc, [name, description, type]) => {
      let result = '  ' + pad(name, indent - name.length + 1) + description;
      const padNum = process.stdout.columns - result.length - type.length;
      result = pad(result, padNum) + type;
      return acc + result + '\n';
    }, '');

    if (this.commands.size !== 0) {
      help += '\n\nCommands:\n';
      for (const [name, opt] of this.commands) {
        help += `  ${name}`;
        if (opt.description) help += `: ${opt.description}`;
        help += '\n';
      }
    }
    return help;
  }

  [getVersion]() {
    const file = searchFile('package.json');
    if (file) return require(file).version;
    return '1.0.0';
  }

  setDefaultOptions(opts) {
    this.defaultOptions = { ...this.defaultOptions, ...opts };
    return this;
  }

  option(name, options) {
    name = toCamelCase(name);
    const opts = { ...this.defaultOptions, ...options };
    if (opts.alias) this.aliases.set(opts.alias, name);
    if (opts.type === 'counter') {
      opts.array = false;
      this.parsedOptions[name] = 0;
    }
    if (opts.array) {
      if (opts.default) {
        if (Array.isArray(opts.default)) {
          this.parsedOptions[name] = opts.default;
        } else {
          this.parsedOptions[name] = [opts.default];
        }
      } else {
        this.parsedOptions[name] = [];
      }
    } else if (opts.default) {
      this.parsedOptions[name] = opts.default;
    }
    this.options.set(name, opts);
    return this;
  }

  command(name, description, exec) {
    name = toCamelCase(name);
    if (typeof description === 'function') {
      exec = description;
      description = '';
    }
    this.commands.set(name, { description, exec });
    return this;
  }

  usage(str) {
    this.usageStr = str;
    return this;
  }

  showHelp() {
    console.log(this[buildHelp]());
  }

  version() {
    console.log(this[getVersion]());
  }

  parse(argv, cb) {
    this.argvRaw = argv;
    const fileName = argv[1].split(path.sep).pop();
    if (this.usageStr) this.usageStr = this.usageStr.replace('$0', fileName);
    else this.usageStr = fileName;

    let args = this[parseArgs](argv.slice(2));
    if (args.help) {
      this.showHelp();
      process.exit();
    } else if (args.version) {
      this.version();
      process.exit();
    }

    args.rawArgs = this.argvRaw;
    this.options.forEach(({ required }, name) => {
      if (required && args[name] === undefined) {
        console.error(`Option ${name} is required`);
        process.exit(1);
      }
    });

    if (args.config && fs.existsSync(args.config)) {
      const config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
      args = { ...config, ...args };
    }

    this.options.forEach((opt, name) => {
      if (args[name] === undefined && opt.default !== undefined) {
        args[name] = opt.default;
      }
    });

    if (this.parsedCommand) this.parsedCommand(args);
    else if (cb) cb(args);
    return args;
  }
}

module.exports = {
  Cli,
  cli: new Cli(),
};
