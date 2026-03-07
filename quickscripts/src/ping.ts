const response = await fetch('http://localhost:7887/pong');
const data = await response.text();

console.log(data);
