import Product from "../entity/product";

export default class ProduceService {
    private static id = 0;
    createProduct(): Product {
        const product = new Product();
        product.id = ++ProduceService.id;
        product.name = 'Nike sneakers';
        product.price = 80;
        product.count = 0;
        return product;
    }

    onShelf(product: Product, count=0) {
        product.count += count;
        product.isOnSale = true;
    }

    offShelf(product: Product) {
        product.isOnSale = false;
    }
}
