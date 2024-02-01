const config = require('./config.json');
const { getType } = require('./utils');
const { join } = require('path');
const { Project } = require('ts-morph');
const fs = require('fs');
const { z } = require('zod');

const dataPath = join(__dirname, 'lib', 'data.ts');

fs.writeFileSync(dataPath, '');

const sourceFile = new Project().addSourceFileAtPath(dataPath);

sourceFile.addStatements(
	'// THIS IS A CODE GENERATED FILE - see generate.js for more info'
);

sourceFile.addImportDeclaration({ namedImports: 'z', moduleSpecifier: 'zod' });

config.forEach(({ name, path }) => {
	console.log(`Generating ${name} from file ${path}`);

	const p = join(__dirname, path);
	const type = getType(name, p);

	console.log('Done getting type');

	let importPath = path;
	if (importPath.startsWith('node_modules/'))
		importPath = importPath.substring('node_modules/'.length);

	sourceFile.addImportDeclaration({
		namedImports: [name],
		moduleSpecifier: importPath,
		isTypeOnly: true,
	});

	sourceFile.addStatements(`export { ${name} }`);

	const schema = generateSchema(type);

	const code = generateCodeFromSchema(schema);

	console.log('Generated schema');

	sourceFile.addStatements(`export const ${name}Schema = ${code}`);
});

sourceFile.saveSync();

function generateSchema(data) {
	let s;
	switch (data?.type || data) {
		case 'string':
			s = z.string();
			break;
		case 'number':
			s = z.number();
			break;
		case 'boolean':
			s = z.boolean();
			break;
		case 'undefined':
			s = z.undefined();
			break;
		case 'null':
			s = z.null();
			break;
		case 'unknown':
			s = z.unknown();
			break;
		case 'array':
			s = z.array(generateSchema(data.arrayType));
			break;
		default:
			if (typeof data !== 'object') {
				s = z.unknown();
			} else if (['object', 'interface'].includes(data.type)) {
				const obj = {};
				for (const [k, v] of Object.entries(data.obj)) {
					obj[k] = generateSchema(v);
				}
				s = z.object(obj);
			} else if (data.type === 'enum') {
				if (typeof data.values[0] === 'number') {
					s = z.number();
				} else {
					if (data.values && Array.isArray(data.values)) {
						const enumObj = {};
						data.values.forEach((v) => {
							enumObj[`_${v}`] = v;
						});
						s = z.nativeEnum(enumObj);
					}
				}
			}
			break;
	}

	if (!s) return z.unknown();

	if (data.optional) s = s.optional();
	if (data.nullable) s = s.nullable();

	return s;
}

function generateCodeFromSchema(s, first = true) {
	let c = 'z';

	let innerType = s._def.innerType;
	while (innerType != undefined && first) {
		c = `z${generateCodeFromSchema(innerType, false).substring(1)}${c.substring(
			1
		)}`;
		innerType = innerType._def.innerType;
	}

	switch (s._def.typeName) {
		case 'ZodString':
			c += '.string()';
			break;
		case 'ZodNumber':
			c += '.number()';
			break;
		case 'ZodBoolean':
			c += '.boolean()';
			break;
		case 'ZodUndefined':
			c += '.undefined()';
			break;
		case 'ZodOptional':
			c += '.optional()';
			break;
		case 'ZodNull':
			c += '.null()';
			break;
		case 'ZodNullable':
			c += '.nullable()';
			break;
		case 'ZodObject':
			c += `.object({${Object.entries(s._def.shape())
				.map(([k, v]) => {
					return `\n${k}: ${generateCodeFromSchema(v)},`;
				})
				.join('')}\n})`;
			break;
		case 'ZodNativeEnum':
			c += `.nativeEnum(${JSON.stringify(s._def.values)})`;
			break;
		case 'ZodUnknown':
			c += '.unknown()';
			break;
		case 'ZodUnion':
			c += `.union([${s._def.options.map(generateCodeFromSchema).join(',')}])`;
			break;
		case 'ZodArray':
			c += `.array(${generateCodeFromSchema(s._def.type)})`;
	}

	return c;
}
