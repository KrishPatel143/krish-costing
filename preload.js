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

  // Products (catalog, separate from orders)
  getProducts:                  ()          => ipcRenderer.invoke('db:getProducts'),
  saveProduct:                  (entry)     => ipcRenderer.invoke('db:saveProduct', entry),
  updateProduct:                (id, entry) => ipcRenderer.invoke('db:updateProduct', { id, entry }),
  deleteProduct:                (id)        => ipcRenderer.invoke('db:deleteProduct', id),
  importProductsFromProduction: ()          => ipcRenderer.invoke('db:importProductsFromProduction'),

  getCompanies:  ()            => ipcRenderer.invoke('db:getCompanies'),
  saveCompany:   (entry)       => ipcRenderer.invoke('db:saveCompany', entry),
  updateCompany: (id, entry)   => ipcRenderer.invoke('db:updateCompany', { id, entry }),
  deleteCompany: (id)          => ipcRenderer.invoke('db:deleteCompany', id),

  getQuotations:       ()            => ipcRenderer.invoke('db:getQuotations'),
  getNextQuotationId:  ()            => ipcRenderer.invoke('db:getNextQuotationId'),
  getLastQuotedRates:  (companyId)   => ipcRenderer.invoke('db:getLastQuotedRates', companyId),
  saveQuotation:       (entry)       => ipcRenderer.invoke('db:saveQuotation', entry),
  updateQuotation:     (id, entry)   => ipcRenderer.invoke('db:updateQuotation', { id, entry }),
  deleteQuotation:     (id)          => ipcRenderer.invoke('db:deleteQuotation', id),

  // App info
  getVersion:    ()      => ipcRenderer.invoke('app:getVersion'),
  getDbPath:     ()      => ipcRenderer.invoke('app:getDbPath'),

  printPreview:  (html, title) => ipcRenderer.invoke('print:preview', { html, title }),
});
