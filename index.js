if (process.env.NODE_ENV !== "production") {
	require("dotenv").config();
}

const express = require("express");
const ejsMate = require("ejs-mate");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const session = require("express-session");
const path = require("path");
const catchAsync = require("./utils/catchAsync");
const ExpressError = require("./utils/ExpressError");

const app = express();

app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const secret = process.env.SECRET || "thisshouldbeasecret";
app.use(
	session({
		secret: secret,
		resave: true,
		saveUninitialized: true,
	})
);

const pool = mysql.createPool({
	host: "localhost",
	user: "root",
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME,
});

const promisePool = pool.promise();

function isProductInCart(cart, id) {
	for (let i = 0; i < cart.length; i++) {
		if (cart[i].id == id) {
			return true;
		}
	}
	return false;
}

function calculateTotal(cart, req) {
	total = 0;
	for (let i = 0; i < cart.length; i++) {
		//if we're offering a discounted price
		if (cart[i].sale_price) {
			total = total + cart[i].sale_price * cart[i].quantity;
		} else {
			total = total + cart[i].price * cart[i].quantity;
		}
	}
	req.session.total = total;
	return total;
}

app.get("/", (req, res) => {
	pool.query("SELECT * FROM products", (err, result) => {
		res.render("pages/index", { result });
	});
});

app.post("/add_to_cart", function (req, res) {
	const id = req.body.id;
	const name = req.body.name;
	const price = req.body.price;
	const sale_price = req.body.sale_price;
	const quantity = req.body.quantity;
	const image = req.body.image;

	const product = {
		id: id,
		name: name,
		price: price,
		sale_price: sale_price,
		quantity: quantity,
		image: image,
	};

	if (req.session.cart) {
		const cart = req.session.cart;
		if (!isProductInCart(cart, id)) {
			cart.push(product);
		}
	} else {
		req.session.cart = [product];
		// var cart = req.session.cart;
	}

	const cart = req.session.cart;

	//calculate total
	calculateTotal(cart, req);

	//return to cart page
	res.redirect("/cart");
});

app.get("/cart", (req, res) => {
	const cart = req.session.cart;
	const total = req.session.total;

	res.render("pages/cart", { cart, total });
});

app.post("/remove_product", (req, res) => {
	const id = req.body.id;
	let cart = req.session.cart;

	for (let i = 0; i < cart.length; i++) {
		if (cart[i].id == id) {
			cart.splice(cart.indexOf(i), 1);
		}
	}

	//re-calculate
	calculateTotal(cart, req);
	res.redirect("/cart");
});

app.post("/edit_product_quantity", (req, res) => {
	const id = req.body.id;
	const increase_btn = req.body.increase_product_quantity;
	const decrease_btn = req.body.decrease_product_quantity;
	const cart = req.session.cart;

	if (increase_btn) {
		for (let i = 0; i < cart.length; i++) {
			if (cart[i].id == id) {
				if (cart[i].quantity > 0) {
					cart[i].quantity = parseInt(cart[i].quantity) + 1;
				}
			}
		}
	}

	if (decrease_btn) {
		for (let i = 0; i < cart.length; i++) {
			if (cart[i].id == id) {
				if (cart[i].quantity > 1) {
					cart[i].quantity = parseInt(cart[i].quantity) - 1;
				}
			}
		}
	}

	calculateTotal(cart, req);
	res.redirect("/cart");
});

app.get("/checkout", (req, res) => {
	const total = req.session.total;
	res.render("pages/checkout", { total });
});

app.post("/place_order", (req, res) => {
	const name = req.body.name;
	const email = req.body.email;
	const phone = req.body.phone;
	const city = req.body.city;
	const address = req.body.address;
	const cost = req.session.total;
	let status = "not paid";
	const date = new Date();
	let products_ids = "";
	const id = Date.now();
	req.session.order_id = id;

	const cart = req.session.cart;
	for (let i = 0; i < cart.length; i++) {
		products_ids = products_ids + "," + cart[i].id;
	}

	const query =
		"INSERT INTO orders (id, cost, name, email, status, city, address, phone, date, products_ids) VALUES ?";
	const values = [
		[
			id,
			cost,
			name,
			email,
			status,
			city,
			address,
			phone,
			date,
			products_ids,
		],
	];
	pool.query(query, [values], (err, result) => {
		for (let i = 0; i < cart.length; i++) {
			const query =
				"INSERT INTO order_items (order_id, product_id, product_name, product_price, product_image, product_quantity, order_date";
			const values = [
				[
					id,
					cart[i].id,
					cart[i].name,
					cart[i].price,
					cart[i].image,
					cart[i].quantity,
					new Date(),
				],
			];
			pool.query(query, [values], (err, result) => {});
		}
		res.redirect("/payment");
	});
});

app.get("/payment", (req, res) => {
	const total = req.session.total;
	res.render("pages/payment", { total });
});

app.get("/verify_payment", async (req, res) => {
	const transaction_id = req.query.transaction_id;
	const order_id = req.session.order_id;

	const query =
		"INSERT INTO payments (order_id, transaction_id, date) VALUES ?";
	const values = [[order_id, transaction_id, new Date()]];

	await promisePool.query(query, [values], (err, result) => {
		pool.query(`UPDATE orders SET status='paid' WHERE id=${order_id}`);
		res.redirect("/thank_you");
	});
});

app.get("/thank_you", (req, res) => {
	const order_id = req.session.order_id;
	res.render("pages/thank_you", { order_id });
});

app.get("/single_product", (req, res) => {
	const id = req.query.id;

	pool.query(
		"SELECT * FROM products WHERE id='" + id + "'",
		(err, result) => {
			res.render("pages/single_product", { result });
		}
	);
});

app.get("/products", (req, res) => {
	pool.query("SELECT * FROM products", (err, result) => {
		res.render("pages/products", { result });
	});
});

app.get("/about", (req, res) => {
	res.render("pages/about");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
	console.log(`Server running on port ${port}...`);
});
