const vehicleId = process.argv[2];
const intervalMs = parseInt(process.argv[3] ?? '', 10);

if (!vehicleId || isNaN(intervalMs)) {
  console.error('Usage: vehicle-refill-loop <vehicleName> <intervalMs>');
  process.exit(1);
}

while (true) {
  // Shutdown
  await fetch('http://localhost:7887/vehicle/actions/shutdown', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ vehicleId }),
  });

  await Bun.sleep(50);

  // Refill
  const refillResponse = await fetch('http://localhost:7887/vehicle/actions/refill', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ vehicleId }),
  });
  const refillData = await refillResponse.json();

  await Bun.sleep(50);

  // Ignite
  const igniteResponse = await fetch('http://localhost:7887/vehicle/actions/ignite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ vehicleId }),
  });
  const igniteData = await igniteResponse.json();

  console.clear();
  console.log(`[${new Date().toISOString()}]`, JSON.stringify({ refill: refillData, ignite: igniteData }, null, 2));

  await Bun.sleep(intervalMs);
}
