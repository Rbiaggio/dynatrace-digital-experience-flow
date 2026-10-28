declare module '*.css';
// As bibliotecas da tela (ui/app/lib) que a ação importa citam o armazenamento do navegador, sempre dentro de try/catch:
// no runtime da ação ele não existe e a chamada cai no catch. Só os tipos, para a checagem.
interface ArmazenamentoNavegador { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
declare const localStorage: ArmazenamentoNavegador;
declare const sessionStorage: ArmazenamentoNavegador;
