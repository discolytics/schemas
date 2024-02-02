const { Project } = require('ts-morph');

const enumValues = new Map();

const stripImportFromTextRegex = /import\(".+"\).(.+)/;
const stripImportFromText = (text) => {
	if (!text.startsWith('import')) return text;
	const res = text.match(stripImportFromTextRegex);
	return res?.[1] ?? text;
};

const evalType = (
	type,
	filePath,
	alreadyImported,
	dontAllow = [],
	dontAllowNext = []
) => {
	if (
		['string', 'number', 'boolean', 'null', 'undefined'].includes(
			type.getText()
		)
	)
		return type.getText();

	if (['false', 'true'].includes(type.getText())) return 'boolean';

	if (type.isEnum()) {
		return { type: 'enum', values: getType(type.getText(), filePath) };
	}

	if (type.isUnion()) {
		let types = type.getUnionTypes();

		let isEnum = false;
		types.forEach((t) => {
			if (t.isEnumLiteral()) isEnum = true;
		});

		let unionTypes = types.map((t) =>
			evalType(t, filePath, undefined, dontAllow, dontAllowNext)
		);

		if (unionTypes.filter((t) => t === 'boolean').length > 1) {
			const idx = unionTypes.indexOf('boolean');
			unionTypes.splice(idx, 1);
		}

		let optional = false;
		let nullable = false;

		const undefinedIndex = unionTypes.indexOf('undefined');
		if (undefinedIndex > -1) {
			unionTypes.splice(undefinedIndex, 1);
			optional = true;
		}

		const nullIndex = unionTypes.indexOf('null');
		if (nullIndex > -1) {
			unionTypes.splice(nullIndex, 1);
			nullable = true;
		}

		if (isEnum) {
			if (unionTypes.length === 1 && unionTypes[0].type === 'enum') {
				unionTypes = unionTypes[0].values;
			}
			return { type: 'enum', values: unionTypes, nullable, optional };
		}

		if (unionTypes.length === 1) {
			let data = unionTypes[0];
			if (typeof data === 'string') data = { type: data };
			return { ...data, optional, nullable };
		}

		if (unionTypes.length < 1) {
			if (optional) return { type: 'undefined', optional: true, nullable };
			else if (nullable) return { type: 'null', nullable: true };
		}

		return { type: 'union', unionTypes, optional, nullable };
	}

	if (type.getArrayElementType() != null) {
		const t = type.getArrayElementType();
		return { type: 'array', arrayType: evalType(t, filePath) };
	}

	if (type.isInterface()) {
		const newDontAllow = [];
		if (dontAllowNext.includes(stripImportFromText(type.getText())))
			newDontAllow.push(stripImportFromText(type.getText()));

		return {
			type: 'interface',
			obj: getType(type.getText(), filePath, undefined, newDontAllow),
		};
	}

	if (type.isStringLiteral()) {
		if (type.getText().startsWith('import('))
			return getType(type.getText(), filePath);
		return { type: 'stringLiteral', value: type.getText().replace(/"/g, '') };
	}

	if (type.isTuple()) {
		return {
			type: 'tuple',
			elements: type
				.getTupleElements()
				.map((t) => evalType(t, filePath, alreadyImported)),
		};
	}

	if (type.isObject() || type.isIntersection()) {
		try {
			const obj = {};
			type.getProperties().forEach((property) => {
				const name = property.getName();
				const type = evalType(
					property.getDeclarations()[0].getType(),
					filePath
				);
				obj[name] = type;
			});
			return { type: 'object', obj };
		} catch {
			return 'unknown';
		}
	}

	if (type.getText() !== alreadyImported) {
		return getType(type.getText(), filePath) ?? 'unknown';
	}
	return 'unknown';
};

const getType = (name, filePath, alreadyImported, dontAllow = []) => {
	const sourceFile = new Project({
		compilerOptions: { strictNullChecks: true },
	}).addSourceFileAtPath(filePath);

	// if (name === 'APIEmoji') {
	// 	console.log(name, filePath);
	// 	console.log(
	// 		sourceFile
	// 			.getInterface(name)
	// 			.getProperties()
	// 			.map((prop) => console.log(prop.getText()))
	// 			);
	// 			console.log(
	// 			sourceFile
	// }

	let prop;
	if (name.includes('.') && !name.startsWith('import')) {
		prop = name.split('.')[1];
		name = name.split('.')[0];
	}

	const enumDeclaration = sourceFile.getEnum(name);
	if (enumDeclaration) {
		if (prop) {
			const k = `${name}.${prop}`;
			if (enumValues.get(k)) return enumValues.get(k);
			const val = enumDeclaration.getMember(prop)?.getValue() ?? 'unknown';
			if (val !== 'unknown') enumValues.set(k, val);
			return val;
		}
		const values = [];
		enumDeclaration.getMembers().forEach((member) => {
			values.push(member.getValue());
		});
		return { type: 'enum', values };
	}

	const typeDeclaration = sourceFile.getTypeAlias(name);
	if (typeDeclaration) {
		const type = typeDeclaration.getType();
		if (type.getProperties().length > 0) {
			const obj = {};
			type.getProperties().forEach((property) => {
				const propertyName = property.getName();
				for (const s of dontAllow) {
					if (stripImportFromText(type.getText()).includes(s)) {
						obj[propertyName] = { type: 'unknown', overflow: true };
						return;
					}
				}

				const typeRes = evalType(
					property.getDeclarations()[0].getType(),
					filePath,
					undefined,
					[name]
				);
				obj[propertyName] = typeRes;
			});
			return { type: 'object', obj };
		}

		return evalType(type, filePath, alreadyImported);
	}

	const interfaceDeclaration = sourceFile.getInterface(name);
	if (interfaceDeclaration) {
		const obj = {};
		const properties = interfaceDeclaration.getProperties();
		interfaceDeclaration.getExtends().forEach((x) => {
			const t = x.getType();
			const props = t.getProperties();
			for (const p of props) {
				const name = p.getName();
				const exists = properties.find((y) => y.getName() === name);
				if (!exists) properties.push(p);
			}
		});
		properties.forEach((property) => {
			const propertyName = property.getName();
			for (const s of dontAllow) {
				if (stripImportFromText(property.getType().getText()).includes(s)) {
					obj[propertyName] = { type: 'unknown', overflow: true };
					return;
				}
			}

			const t =
				property.getType?.() ?? property.getDeclarations?.()?.[0]?.getType();

			const propertyType = evalType(t, filePath, alreadyImported, [], [name]);
			obj[propertyName] = propertyType;
		});
		return obj;
	}

	if (name.startsWith('import')) {
		const re = /import\("(.+)"\).(.+)/;
		const data = name.match(re);
		if (data) {
			let importPath = data[1];
			if (!importPath.endsWith('.ts')) importPath += '.d.ts';
			const typeName = data[2];
			return getType(typeName.split(' ')[0], importPath, name, dontAllow);
		}
	}

	return 'unknown';
};

module.exports.getType = getType;
