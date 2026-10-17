import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
    title: 'Dashboard — Price History',
  },
  {
    path: 'add',
    loadComponent: () => import('./features/add-product/add-product').then((m) => m.AddProduct),
    title: 'Add product — Price History',
  },
  {
    path: 'search',
    loadComponent: () => import('./features/search/search').then((m) => m.Search),
    title: 'Search — Price History',
  },
  {
    path: 'products/:id',
    loadComponent: () =>
      import('./features/product-detail/product-detail').then((m) => m.ProductDetail),
    title: 'Product — Price History',
  },
  {
    path: 'compare',
    loadComponent: () => import('./features/compare/compare').then((m) => m.Compare),
    title: 'Compare — Price History',
  },
  {
    path: '**',
    loadComponent: () => import('./features/not-found/not-found').then((m) => m.NotFound),
    title: 'Not found — Price History',
  },
];
