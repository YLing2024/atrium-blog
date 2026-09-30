// eslint.config.mjs —— flat config
//
// 原则（见 /root/proj/ENGINEERING_BASELINE.md 第 3 节）：
//   · 只开正确性规则（typescript-eslint recommended），不加任何格式/风格规则
//   · 不引 Prettier、不重排既有代码
//   · 后端是 CommonJS 零构建：sourceType=commonjs，并声明 Node 全局
//
// 说明：eslint 10 不再随包提供 `globals`，且 typescript-eslint recommended 已关闭
// 核心 `no-undef`（交给 TS 处理）；此处仍显式声明 Node 全局，保持与规范一致、
// 也避免日后加入核心规则时误报。
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'data/**', 'uploads/**', 'src/uploads/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
      parserOptions: {
        // 后端按规范做类型信息连接（tsconfig.json 的 include 覆盖 src）
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 未使用变量保持 warn 不报错（规范要求）
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // 本项目是 CommonJS 零构建，require() 是既定运行时写法，非错误
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
  {
    // 测试文件不在 tsconfig 的 include 内，不做类型信息连接
    files: ['test/**/*.ts'],
    languageOptions: {
      parserOptions: { project: false },
    },
  }
)
