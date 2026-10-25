// Contexto da requisição (quem está usando e de onde) disponível em qualquer ponto do código, inclusive no banco
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
module.exports = {
  run: (store, fn) => als.run(store, fn),
  atual: () => als.getStore() || null,
};
