import { builtinModules } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const vendor = /^(?:(?:openai|ai|google-auth-library)(?:\/|$)|@ai-sdk\/|@openrouter\/|@google\/|@anthropic-ai\/|@capacitor\/)/;
const nodeModules = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

export const boundaries = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'This import crosses the Vulpes {{layer}} boundary.', dynamic: 'Use a literal module name so boundaries can be checked.' },
  },
  create(context) {
    const root = context.cwd;
    const filename = context.filename;
    const relative = path.relative(root, filename).replaceAll('\\', '/');
    const browser = relative.startsWith('src/');
    const shared = relative.startsWith('shared/');
    const domain = /^server\/(?:services|analytics)\//.test(relative);
    if (!browser && !shared && !domain) return {};

    function check(node, source) {
      if (!source || typeof source.value !== 'string') {
        context.report({ node, messageId: 'dynamic' });
        return;
      }
      const specifier = source.value;
      const resolved = ts.resolveModuleName(specifier, filename, {
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        paths: { '@/*': ['./src/*'], '@server/*': ['./server/*'], '@shared/*': ['./shared/*'] },
      }, ts.sys).resolvedModule?.resolvedFileName;
      const target = resolved ? path.relative(root, resolved).replaceAll('\\', '/') : '';
      const external = /(?:^|\/)node_modules\//.test(target);
      const localTarget = external ? '' : target;
      const lexicalTarget = specifier.startsWith('.')
        ? path.relative(root, path.resolve(path.dirname(filename), specifier)).replaceAll('\\', '/')
        : specifier.replace(/^@server\//, 'server/').replace(/^@shared\//, 'shared/');
      const implementationImport = /^server\/ai\/adapters\//.test(localTarget || lexicalTarget);
      const harnessImport = /^(?:tests|scripts)\//.test(localTarget || lexicalTarget);
      const serverImport = /^(?:server|api)\//.test(localTarget) || /^@server\//.test(specifier);
      const uiImport = localTarget.startsWith('src/') || /^(?:react(?:-dom)?(?:\/|$)|@assistant-ui\/)/.test(specifier);
      const forbidden = vendor.test(specifier)
        || ((browser || shared) && (serverImport || nodeModules.has(specifier)))
        || (shared && localTarget.startsWith('src/'))
        || implementationImport || harnessImport
        || (domain && uiImport);
      if (forbidden) context.report({ node, messageId: 'forbidden', data: { layer: browser ? 'client' : shared ? 'shared' : 'domain' } });
    }

    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => { if (node.source) check(node, node.source); },
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
      TSImportType: (node) => check(node, node.source),
      CallExpression: (node) => { if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, node.arguments[0]); },
      TSExternalModuleReference: (node) => check(node, node.expression),
    };
  },
};
