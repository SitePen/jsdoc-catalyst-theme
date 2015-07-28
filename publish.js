/* jshint es3:false, node:true */
(function () {
	/* global env:false */
	var fs = require('jsdoc/fs');
	var helper = require('jsdoc/util/templateHelper');
	var logger = require('jsdoc/util/logger');
	var path = require('jsdoc/path');
	var template = require('jsdoc/template');
	var util = require('util');
	var htmlsafe = helper.htmlsafe;
	var linkto = helper.linkto;
	var resolveAuthorLinks = helper.resolveAuthorLinks;
	var data;
	var view;
	var outdir = env.opts.destination;

	function find(spec) {
		return helper.find(data, spec);
	}

	function getAncestorLinks(doclet) {
		return helper.getAncestorLinks(data, doclet);
	}

	function hashToLink(doclet, hash) {
		if (!/^(#.+)/.test(hash)) {
			return hash;
		}

		var url = helper.createLink(doclet);

		url = url.replace(/(#.+|$)/, hash);
		return '<a href="' + url + '">' + hash + '</a>';
	}

	function needsSignature(doclet) {
		var needsSig = false;

		// function and class definitions always get a signature
		if (doclet.kind === 'function' || doclet.kind === 'class') {
			needsSig = true;
		} else if (doclet.kind === 'typedef' && doclet.type && doclet.type.names && doclet.type.names.length) {
			for (var i = 0, l = doclet.type.names.length; i < l; i++) {
				if (doclet.type.names[i].toLowerCase() === 'function') {
					needsSig = true;
					break;
				}
			}
		}

		return needsSig;
	}

	function getSignatureAttributes(item) {
		var attributes = [];

		if (item.optional) {
			attributes.push('opt');
		}

		if (item.nullable === true) {
			attributes.push('nullable');
		}
		else if (item.nullable === false) {
			attributes.push('non-null');
		}

		return attributes;
	}

	function addParamAttributes(params) {
		return params.map(function (item) {
			var attributes = getSignatureAttributes(item);
			var itemName = item.name || '';

			if (item.variable) {
				itemName = '…' + itemName;
			}

			if (attributes && attributes.length) {
				itemName = util.format(
					'%s<span class="signature-attributes">%s</span>',
					itemName,
					attributes.join(', ')
				);
			}

			if (item.type && item.type.names && item.type.names.length) {
				var types = buildItemTypeStrings(item);
				itemName = util.format(
					'%s:<span class="type-signature"> %s</span>',
					itemName,
					types.join('|').replace(/module:/g, '')
				);
			}

			return itemName.replace(/module:/g, '');
		});
	}

	function buildItemTypeStrings(item) {
		var types = [];

		if (item.type && item.type.names) {
			item.type.names.forEach(function (name) {
				types.push(linkto(name, htmlsafe(name)));
			});
		}

		return types;
	}

	function buildAttribsString(attribs) {
		var attribsString = '';

		if (attribs && attribs.length) {
			attribsString = htmlsafe(util.format('(%s) ', attribs.join(', ')));
		}

		return attribsString;
	}

	function addNonParamAttributes(items) {
		var types = [];

		items.forEach(function (item) {
			types = types.concat(buildItemTypeStrings(item));
		});

		return types;
	}

	function addSignatureParams(f) {
		var params = f.params ? addParamAttributes(f.params) : [];

		f.signature = util.format('%s(%s)', (f.signature || ''), params.join(', '));
	}

	function addSignatureReturns(f) {
		var attribs = [];
		var attribsString = '';
		var returnTypes = [];
		var returnTypesString = '';
		var sep = '';

		// jam all the return-type attributes into an array. this could create odd results (for example,
		// if there are both nullable and non-nullable return types), but let's assume that most people
		// who use multiple @return tags aren't using Closure Compiler type annotations, and vice-versa.
		if (f.returns) {
			f.returns.forEach(function (item) {
				helper.getAttribs(item).forEach(function (attrib) {
					if (attribs.indexOf(attrib) === -1) {
						attribs.push(attrib);
					}
				});
			});

			attribsString = buildAttribsString(attribs);
		}

		if (f.returns) {
			returnTypes = addNonParamAttributes(f.returns);
		}

		if (returnTypes.length) {
			returnTypesString = util.format('%s', attribsString, returnTypes.join('|'));
			sep = ':';
		}

		f.signature = '<span class="signature">' + (f.signature || '') + sep + '</span>' +
			'<span class="type-signature">' + returnTypesString.replace(/module:/g, '') + '</span>';
	}

	function addSignatureTypes(f) {
		var types = f.type ? buildItemTypeStrings(f) : [];
		var sep = types.length ? ':' : '';

		f.signature = (f.signature || '') + sep + '<span class="type-signature">' +
			(types.length ? ' ' + types.join('|').replace(/module:/g, '') : '') + '</span>';
	}

	function addAttribs(f) {
		var attribs = helper.getAttribs(f);
		var attribsString = buildAttribsString(attribs);

		f.attribs = util.format('<span class="type-signature">%s</span>', attribsString.replace(/module:/g, ''));
	}

	function shortenPaths(files, commonPrefix) {
		Object.keys(files).forEach(function (file) {
			files[file].shortened = files[file].resolved.replace(commonPrefix, '')
				// always use forward slashes
				.replace(/\\/g, '/');
		});

		return files;
	}

	function getPathFromDoclet(doclet) {
		if (!doclet.meta) {
			return null;
		}

		return doclet.meta.path && doclet.meta.path !== 'null' ?
			path.join(doclet.meta.path, doclet.meta.filename) :
			doclet.meta.filename;
	}

	function generate(title, doc, filename, resolveLinks) {
		resolveLinks = resolveLinks === false ? false : true;

		var members = helper.getMembers(data);
		var modules = helper.getMembers(data).modules;

		var docData = {
			title: title,
			doc: doc,
			members: members,
			modules: modules
		};

		var outpath = path.join(outdir, filename);
		var html = view.render('main.tmpl', docData);

		if (resolveLinks) {
			html = html.replace(/(\{@link )module:([^}| ]+)(\})/g, '$1module:$2 $2$3');
			html = helper.resolveLinks(html); // turn {@link foo} into <a href="foodoc.html">foo</a>
		}

		fs.writeFileSync(outpath, html, 'utf8');
	}

	function generateSourceFiles(sourceFiles, encoding) {
		encoding = encoding || 'utf8';
		Object.keys(sourceFiles).forEach(function (file) {
			var source;
			// links are keyed to the shortened path in each doclet's `meta.shortpath` property
			var sourceOutfile = helper.getUniqueFilename(sourceFiles[file].shortened);
			helper.registerLink(sourceFiles[file].shortened, sourceOutfile);

			try {
				source = {
					kind: 'source',
					code: helper.htmlsafe(fs.readFileSync(sourceFiles[file].resolved, encoding)),
					longname: sourceFiles[file].shortened
				};
			}
			catch (error) {
				logger.error('Error while generating source file %s: %s', file, error.message);
			}

			generate('Source: ' + sourceFiles[file].shortened, source, sourceOutfile, false);
		});
	}

	/**
	 * Look for classes or functions with the same name as modules (which indicates that the module
	 * exports only that class or function), then attach the classes or functions to the `module`
	 * property of the appropriate module doclets. The name of each class or function is also updated
	 * for display purposes. This function mutates the original arrays.
	 *
	 * @private
	 * @param {Array.<module:jsdoc/doclet.Doclet>} doclets - The array of classes and functions to
	 * check.
	 * @param {Array.<module:jsdoc/doclet.Doclet>} modules - The array of module doclets to search.
	 */
	function attachModuleSymbols(doclets, modules) {
		var symbols = {};

		// build a lookup table
		doclets.forEach(function (symbol) {
			symbols[symbol.longname] = symbol;
		});

		return modules.map(function (module) {
			if (symbols[module.longname]) {
				module.module = symbols[module.longname];
				module.module.name = module.module.name.replace('module:', '(require("') + '"))';
			}
		});
	}

	/**
		@param {TAFFY} taffyData See <http://taffydb.com/>.
		@param {object} opts
		@param {Tutorial} tutorials
	 */
	exports.publish = function (taffyData, opts, tutorials) {
		/* jshint maxcomplexity:13 */
		data = taffyData;

		var conf = env.conf.templates || {};
		conf.default = conf.default || {};

		var templatePath = opts.template;
		view = new template.Template(templatePath + '/tmpl');

		// claim some special filenames in advance, so the All-Powerful Overseer of Filename Uniqueness
		// doesn't try to hand them out later
		var indexUrl = helper.getUniqueFilename('index');
		// don't call registerLink() on this one! 'index' is also a valid longname

		var globalUrl = helper.getUniqueFilename('global');
		helper.registerLink('global', globalUrl);

		// set up templating
		view.layout = conf.default.layoutFile ?
			path.getResourcePath(path.dirname(conf.default.layoutFile), path.basename(conf.default.layoutFile)) :
			'layout.tmpl';

		// set up tutorials for helper
		helper.setTutorials(tutorials);

		data = helper.prune(data);
		data.sort('longname, version, since');
		helper.addEventListeners(data);

		var sourceFiles = {};
		var sourceFilePaths = [];
		data().each(function (doclet) {
			doclet.attribs = '';

			if (doclet.examples) {
				doclet.examples = doclet.examples.map(function (example) {
					var caption;
					var code;

					if (example.match(/^\s*<caption>([\s\S]+?)<\/caption>(\s*[\n\r])([\s\S]+)$/i)) {
						caption = RegExp.$1;
						code	= RegExp.$3;
					}

					return {
						caption: caption || '',
						code: code || example
					};
				});
			}

			if (doclet.see) {
				doclet.see.forEach(function (seeItem, i) {
					doclet.see[i] = hashToLink(doclet, seeItem);
				});
			}

			// build a list of source files
			var sourcePath;
			if (doclet.meta) {
				sourcePath = getPathFromDoclet(doclet);
				sourceFiles[sourcePath] = {
					resolved: sourcePath,
					shortened: null
				};
				if (sourceFilePaths.indexOf(sourcePath) === -1) {
					sourceFilePaths.push(sourcePath);
				}
			}

			// pre-generate the link map
			var url = helper.createLink(doclet);
			helper.registerLink(doclet.longname, url);
		});

		// update outdir if necessary, then create outdir
		var packageInfo = (find({ kind: 'package' }) || [])[0];
		if (packageInfo && packageInfo.name) {
			outdir = path.join(outdir, packageInfo.name, packageInfo.version);
		}
		fs.mkPath(outdir);

		// copy the template's static files to outdir
		var fromDir = path.join(templatePath, 'static');
		var staticFiles = fs.ls(fromDir, 3);

		staticFiles.forEach(function (fileName) {
			var toDir = fs.toDir(fileName.replace(fromDir, outdir));
			fs.mkPath(toDir);
			fs.copyFileSync(fileName, toDir);
		});

		// copy user-specified static files to outdir
		var staticFilePaths;
		var staticFileFilter;
		var staticFileScanner;
		if (conf.default.staticFiles) {
			staticFilePaths = conf.default.staticFiles.paths || [];
			staticFileFilter = new (require('jsdoc/src/filter')).Filter(conf.default.staticFiles);
			staticFileScanner = new (require('jsdoc/src/scanner')).Scanner();

			staticFilePaths.forEach(function (filePath) {
				var extraStaticFiles = staticFileScanner.scan([filePath], 10, staticFileFilter);

				extraStaticFiles.forEach(function (fileName) {
					var sourcePath = fs.toDir(filePath);
					var toDir = fs.toDir(fileName.replace(sourcePath, outdir));
					fs.mkPath(toDir);
					fs.copyFileSync(fileName, toDir);
				});
			});
		}

		if (env.conf.projectLogo) {
			fs.copyFileSync(env.conf.projectLogo, outdir, path.basename(env.conf.projectLogo));
			env.conf.projectLogo = path.basename(env.conf.projectLogo);
		}

		if (sourceFilePaths.length) {
			sourceFiles = shortenPaths(sourceFiles, path.commonPrefix(sourceFilePaths));
		}

		data().each(function (doclet) {
			// add a shortened version of the full path
			var docletPath;
			if (doclet.meta) {
				docletPath = getPathFromDoclet(doclet);
				docletPath = sourceFiles[docletPath].shortened;
				if (docletPath) {
					doclet.meta.shortpath = docletPath;
				}
			}

			var url = helper.longnameToUrl[doclet.longname];

			if (url.indexOf('#') > -1) {
				doclet.id = helper.longnameToUrl[doclet.longname].split(/#/).pop();
			}
			else {
				doclet.id = doclet.name;
			}

			if (needsSignature(doclet)) {
				// Assume that an extended class with no parameters of its own should use the parameters from the
				// parent class
				if (!doclet.params && doclet.augments && doclet.augments[0]) {
					var parent = find({ longname: doclet.augments[0] })[0];
					if (parent) {
						doclet.params = parent.params;
					}
				}

				addSignatureParams(doclet);
				addSignatureReturns(doclet);
				addAttribs(doclet);
			}

			doclet.ancestors = getAncestorLinks(doclet);

			if (doclet.kind === 'class') {
				doclet.superclasses = (function () {
					var doc = doclet;
					var lineage = [];
					while (doc && doc.augments && doc.augments.length) {
						lineage.push(doc.augments[0]);
						doc = find({ longname: doc.augments[0] })[0];
					}
					lineage.push('Object');
					return lineage;
				})();

				doclet.subclasses = find({ kind: 'class' }).filter(function (clazz) {
					return clazz.augments && clazz.augments.indexOf(doclet.longname) === 0;
				}).map(function (doc) {
					return doc.longname;
				});
			}

			if (doclet.kind === 'member') {
				addSignatureTypes(doclet);
				addAttribs(doclet);
			}

			if (doclet.kind === 'constant') {
				addSignatureTypes(doclet);
				addAttribs(doclet);
				doclet.kind = 'member';
			}

			if (doclet.description && !doclet.summary) {
				doclet.summary = doclet.description.slice(
					0,
					(doclet.description.search(/\.(?:\s|<\/p>)/) + 1) || Infinity
				).replace(/(?:<\/p>)?$/, '</p>');
			}
		});

		var members = helper.getMembers(data);

		// output pretty-printed source files by default
		var outputSourceFiles = conf.default && conf.default.outputSourceFiles !== false ? true : false;

		// add template helpers
		view.find = find;
		view.linkto = linkto;
		view.resolveAuthorLinks = resolveAuthorLinks;
		view.htmlsafe = htmlsafe;
		view.outputSourceFiles = outputSourceFiles;
		view.getIcons = function (member) {
			function icon(type, name) {
				return '<span class="icon icon-' + type + '" title="' + htmlsafe(name) + '"></span>';
			}

			var icons = [];
			member.inherited && icons.push(icon('inherited', 'Inherited'));
			member.deprecated && icons.push(icon('deprecated', 'Deprecated'));
			return icons;
		};
		view.formatTypeList = function (types) {
			return types.map(function (name) {
				return '<span class="param-type">' + linkto(name, htmlsafe(name.replace(/module:/g, ''))) + '</span>';
			}).join('|');
		};
		view.getMemberCssClass = function (member) {
			var classes = [ 'member', 'kind-' + member.kind ];
			member.inherited && classes.push('inherited');
			member.deprecated && classes.push('deprecated');
			return classes.join(' ');
		};

		attachModuleSymbols(find({ kind: { '!is': 'module' }, longname: { left: 'module:' } }), members.modules);

		// generate the pretty-printed source files first so other pages can link to them
		if (outputSourceFiles) {
			generateSourceFiles(sourceFiles, opts.encoding);
		}

		members.globals.length && generate('Globals', { kind: 'globalobj' }, globalUrl);

		generate('Index', { kind: 'index', readme: opts.readme, longname: opts.mainpagetitle || 'Index' }, indexUrl);

		members.modules.forEach(function (module) {
			generate('Module: ' + module.name, module, helper.longnameToUrl[module.longname]);
		});
	};
})();
