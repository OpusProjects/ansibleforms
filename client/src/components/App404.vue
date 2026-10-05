<!-- eslint-disable vue/multi-word-component-names -- the App prefix already namespaces this component, "404" is not seen as a second word -->
<script setup>
/******************************************************************/
/*                                                                */
/*  404 Page component                                            */
/*                                                                */
/******************************************************************/
</script>
<template>
  <div class="container">
    <div class="h-100 d-flex align-items-center justify-content-center mt-5">
      <div>
        <h1>404 / Automation Overload...</h1>
        <p class="font-monospace">
          <b>PLAY [Searching page] ********************************************</b><br />
          <br />
          <b>TASK [Gathering facts] *******************************************</b><br />
          <span class="text-danger">failed: [localhost]</span><br />
          <br />
          <span class="text-danger">Darn, we really couldn't find that page</span>.<br />
          <span class="text-danger">I think we might have lost it...Oh nooo.</span><br />
          <br />
          <b>PLAY RECAP *******************************************************</b><br />
          localhost : OK=0 changed=0 unreachable=1<br />
          <br />
          Playbook finished with exit code 404
        </p>
      </div>
    </div>
  </div>
</template>
