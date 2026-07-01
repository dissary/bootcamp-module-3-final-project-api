let express = require("express");
let path = require("path");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { error } = require("console");
require("dotenv").config();
const { DATABASE_URL, SECRET_KEY } = process.env;

let app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function getPostgresVersion() {
  const client = await pool.connect();

  try {
    const response = await client.query('SELECT version()');
    console.log(response.rows[0]);
  } finally {
    client.release();
  }
}

getPostgresVersion();

// Show all user that book specific class
app.get('/bookings/class/:class_id', async (req, res) => {
  const { class_id } = req.params;
  const client = await pool.connect();

  try {
  const bookings = await client.query(
    'SELECT * FROM bookings WHERE class_id = $1',
    [class_id]
  );
    res.json(bookings.rows);
  } catch (error) {
    console.log(error)
    res.status(500).send("An error occured, please try again.")
  } finally {
    client.release();
  }
})

// Unbook Classes
app.delete('/bookings/:id', async(req,res) => {
  const { id } = req.params;

  const client = await pool.connect();

  try {
    await client.query('DELETE FROM bookings WHERE id = $1', [id]);

    res.json({ message: "Unbook classes successfully."});
  } catch (error) {
    console.log(error)
    res.status(500).send("An error occured, please try again.")
  } finally {
    client.release();
  }
})

// Book Classes
app.post('/bookings', async(req,res) => {
  const { user_id, class_id } = req.body;

  const client = await pool.connect();

  try {
    const newBooking = await client.query('INSERT INTO bookings (user_id, class_id, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING *', [user_id, class_id]);

    res.json(newBooking.rows[0]);
  } catch (error) {
    console.log(error)
    res.status(500).send("An error occured, please try again.")
  } finally {
    client.release();
  }
})

// Show All Classes
app.get('/classes', async (req, res) => {
  const client = await pool.connect();

  try {
    const query = 'SELECT * FROM classes';
    const result = await client.query(query);

    res.json(result.rows);
  } catch (err) {
    console.log(err.stack);
    res.status(500).send('An error occured');
  } finally {
    client.release();
  }
})

// Update Specific Classes
app.put('/classes/:id', async (req, res) => {
  const id = req.params.id
  const updatedData = req.body;
  const client = await pool.connect();

  try {
    const updateQuery = 'UPDATE classes SET title = $1, description = $2, date = $3, time = $4 WHERE id = $5'
    const queryData = [updatedData.title, updatedData,description, updatedData.date, updatedData.time, id]
    await client.query(updateQuery, queryData);

    res.json({  "message": "Class updated successfully."});
  } catch (error) {
    console.log("Error:", error.message);
    res.status(500).send('An error occured');
  } finally {
    client.release();
  }
})

// Delete Specific Classes
app.delete('/classes/:id', async (req, res) => {
  const id = req.params.id
  const client = await pool.connect();

  try {
    const deleteQuery = 'DELETE FROM classes WHERE id = $1';
    await client.query(deleteQuery, [id]);

    res.json({ "message": "Class deleted successfully." });
  } catch (error) {
    console.log("Error:", error.message);
    res.status(500).send('An error occured');
  } finally {
    client.release();
  }
})


// Add Classes
app.post('/classes', async(req, res) => {
  const { user_id, title, description,  date, time } = req.body;
  const client = await pool.connect();

  try {
    const userExists = await client.query('SELECT id FROM users WHERE id = $1', [user_id]);

    if(userExists.rows.length > 0) {
      const post = await client.query('INSERT INTO classes (user_id, title, description, date, time) VALUES ($1, $2, $3, $4, $5) RETURNING *', [user_id, title, description, date, time])
      res.json(post.rows[0]);
    } else {
      res.status(400).json({ error: "User does not exist."});
    }
  } catch (error) {
    console.log(error)
      res.status(500).json({ error: "Something went wrong, please try again later!"});
  } finally {
    client.release();
  }
})


// Sign Up
app.post("/signup", async(req, res) => {
  const client = await pool.connect();

  try {
    const { email, password, phone_number } = req.body;
    const hashedPassword = await bcrypt.hash(password, 12);

    const userResult = await client.query(
      "SELECT * FROM users WHERE email = $1", [email],
    )

    if(userResult.rows.length > 0) {
      return res.status(400).json({ error: "Email already exists."});
    }

    await client.query(
      "INSERT INTO users (email, password, phone_number) VALUES ($1, $2, $3)",
      [email, hashedPassword, phone_number],
    )

    res.status(201).json({ message: "Account created successfully!"});
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error."});
  } finally {
    client.release();
  }
});

// Login 
app.post('/login', async(req, res) => {
  const client = await pool.connect();

  try {

  const { email, password } = req.body;
    const result = await client.query('SELECT * FROM users WHERE email = $1', [email]);

    const user = result.rows[0];

    if (!user) return res.status(400).json({ message: "Email or password incorrect."});

    const passwordIsValid = await bcrypt.compare(password, user.password);
    if(!passwordIsValid) return res.status(401).json({ auth: false, token: null});

    var token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: 86400 });
    res.status(200).json({ auth: true, token: token});
  } catch(error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error."});
  } finally {
    client.release();
  }
})

app.get('/email', (req, res) => {
  const authToken = req.headers.authorization;

  if(!authToken) return res.status(401).json({ error: "Access Denied." });

  try {
    const verified = jwt.verify(authToken, SECRET_KEY);
    res.json({
      email: verified.email
    })
  } catch (err) {
    res.status(400).json({ error: "Invalid Token." });
  }
})

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(3000, () => {
  console.log("App is listening on port 3000");
});


