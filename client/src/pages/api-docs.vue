<script setup>
// No script logic needed for this info page
</script>

<template>
  <AppNav />
  <div class="container py-5">
    <div class="row justify-content-center">
      <div class="col-lg-8">
        <div class="card shadow-sm border-0 mb-4">
          <div class="card-body">
            <h1 class="mb-3">API Documentation</h1>
            <p class="lead">Welcome to the AnsibleForms API documentation portal.</p>
            <p>The REST API is <strong>v2</strong> (API v1 was removed in 7.0.0).</p>
            <div class="bg-light p-3 rounded border mb-3">
              <div class="mb-2">API Docs Endpoint:</div>
              <pre class="mb-0" style="font-family: 'Fira Mono', 'Consolas', monospace; background: none; border: none">
<a href="api/v2/docs">/api/v2/docs</a>
              </pre>
            </div>
            <p class="mb-0 text-muted">
              Click the link above or enter it in your browser to access the interactive Swagger UI.
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
