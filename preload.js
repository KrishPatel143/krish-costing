const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('krish', {
  // Rates (paper)
  getRates:      ()      => ipcRenderer.invoke('db:getRates'),
  saveRates:     (data)  => ipcRenderer.invoke('db:saveRates', data),
  resetRates:    ()      => ipcRenderer.invoke('db:resetRates'),

  // Flex rates
  getFlexRates:  ()      => ipcRenderer.invoke('db:getFlexRates'),
  saveFlexRates: (data)  => ipcRenderer.invoke('db:saveFlexRates', data),
  resetFlexRates:()      => ipcRenderer.invoke('db:resetFlexRates'),

  // Calculation history
  addHistory:    (entry) => ipcRenderer.invoke('db:addHistory', entry),
  getHistory:    ()      => ipcRenderer.invoke('db:getHistory'),
  clearHistory:  ()      => ipcRenderer.invoke('db:clearHistory'),

  // Production orders
  getProductionOrders:      ()            => ipcRenderer.invoke('db:getProductionOrders'),
  getNextProductionOrderId: ()            => ipcRenderer.invoke('db:getNextProductionOrderId'),
  addProductionOrder:       (entry)       => ipcRenderer.invoke('db:addProductionOrder', entry),
  updateProductionDispatch: (id, dispatchQuantity, dispatchDate) =>
    ipcRenderer.invoke('db:updateProductionDispatch', { id, dispatchQuantity, dispatchDate }),
  updateProductionOrder:    (id, entry)   => ipcRenderer.invoke('db:updateProductionOrder', { id, entry }),
  deleteProductionOrder:    (id)          => ipcRenderer.invoke('db:deleteProductionOrder', id),

  // App info
  getVersion:    ()      => ipcRenderer.invoke('app:getVersion'),
  getDbPath:     ()      => ipcRenderer.invoke('app:getDbPath'),
});
