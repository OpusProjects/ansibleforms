<script setup>
/*********************************************************************/
/*                                                                   */
/*  Bootstrap SSH Key component                                      */
/*                                                                   */
/*  @props:                                                          */
/*      type: String (sshPrivateKey, sshPublicKey, sshPrivateKeyArt) */
/*      icon: String                                                 */
/*      required: Boolean                                            */
/*                                                                   */
/*********************************************************************/

import Helpers from '@/lib/Helpers';
import { toast } from 'vue-sonner';

// INIT

// MODEL

const model = defineModel();

// PROPS

defineProps({
  type: {
    type: String,
    required: true,
  },
  icon: {
    type: String,
    default: undefined,
  },
  required: {
    type: Boolean,
    default: false,
  },
});

// METHODS

function copyToClipboard() {
  // await the real result : the success toast used to fire even when nothing was
  // copied (see Helpers.copyToClipboard)
  Helpers.copyToClipboard(model.value)
    .then(() => toast.success('Copied to clipboard'))
    .catch((err) => toast.error(err?.message || 'Could not copy to the clipboard'));
}
</script>
<template>
  <pre class="p-3 border" v-if="type === 'sshPrivateKeyArt'">{{ model }}</pre>
  <BsInputRaw type="text" v-if="type === 'sshPrivateKey'" v-model="model" :icon="icon" :required="required" />
  <p
    class="py-2 px-3 mb-0 border text-break user-select-none"
    v-else-if="type === 'sshPublicKey'"
    @click="copyToClipboard()"
  >
    {{ model }}
  </p>
</template>
